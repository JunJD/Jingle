import { lstat } from "node:fs/promises"
import { getExecuteCommandPolicy } from "@shared/execute-command-policy"
import type { MutationChangeType } from "@shared/mutation-prediction"
import { DEFAULT_PERMISSION_MODE, type PermissionModeName } from "@shared/permission-mode"
import {
  buildToolApprovalItem,
  requiresToolApproval,
  type ComputerUseToolApprovalItem,
  type ToolApprovalItem
} from "@shared/tool-approval"
import { getFileMutationReview, isFileMutationToolName } from "@shared/file-mutation-review"
import { assertExtensionAgentToolName } from "@shared/extension-sources"
import type { ExtensionToolApprovalPolicyProvider } from "../extension-tools/permission"

export type ToolPermissionDisposition = "allow" | "deny" | "require_approval"

export interface ToolPermissionRequest {
  args: unknown
  toolName: string
}

export interface ToolPermissionDecision {
  args: Record<string, unknown>
  disposition: ToolPermissionDisposition
  reason?: string
  review?: ToolApprovalItem | null
}

export interface ToolPermissionRuntime {
  evaluate(request: ToolPermissionRequest): Promise<ToolPermissionDecision>
}

export interface CreateToolPermissionRuntimeOptions {
  computerUseApprovalProvider?: (
    args: Record<string, unknown>
  ) => Promise<ComputerUseToolApprovalItem>
  extensionToolPolicyProvider?: ExtensionToolApprovalPolicyProvider
  permissionMode?: PermissionModeName
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function allow(args: Record<string, unknown>, reason?: string): ToolPermissionDecision {
  return {
    args,
    disposition: "allow",
    reason
  }
}

function deny(args: Record<string, unknown>, reason: string): ToolPermissionDecision {
  return {
    args,
    disposition: "deny",
    reason
  }
}

function requireApproval(
  args: Record<string, unknown>,
  review: ToolApprovalItem,
  reason?: string
): ToolPermissionDecision {
  return {
    args,
    disposition: "require_approval",
    reason,
    review
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false
    }

    throw error
  }
}

export async function resolveFileMutationChangeType(
  toolName: string,
  args: Record<string, unknown>
): Promise<MutationChangeType | null> {
  const review = getFileMutationReview(toolName, args)
  if (!review?.path) {
    return null
  }

  if (review.toolName === "edit_file") {
    return "modify"
  }

  return (await pathExists(review.path)) ? "modify" : "create"
}

async function buildApprovalReview(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolApprovalItem> {
  const fileMutationChangeType = isFileMutationToolName(toolName)
    ? await resolveFileMutationChangeType(toolName, args)
    : undefined

  const review = buildToolApprovalItem(toolName, args, {
    fileMutationChangeType: fileMutationChangeType ?? undefined
  })
  if (!review) {
    throw new Error(`[ToolPermissionRuntime] Missing approval review for tool "${toolName}".`)
  }

  return review
}

async function evaluateExecuteTool(
  toolName: string,
  args: unknown,
  permissionMode: PermissionModeName
): Promise<ToolPermissionDecision | null> {
  if (toolName !== "execute") {
    return null
  }

  if (!isRecord(args)) {
    throw new Error("[ToolPermissionRuntime] Execute tool call args must be an object.")
  }

  const policy = getExecuteCommandPolicy(args)
  if (!policy) {
    throw new Error("[ToolPermissionRuntime] Missing execute command policy metadata.")
  }

  if (policy.disposition === "allow") {
    return allow(args, policy.reason)
  }

  if (policy.disposition === "deny") {
    return deny(args, policy.reason)
  }

  if (policy.profile === "predictable_mutation") {
    if (permissionMode === "explore") {
      return deny(args, "Explore mode allows read-only shell commands only.")
    }

    if (permissionMode === "auto") {
      return allow(args, "Auto mode allows predictable mutating shell commands.")
    }
  }

  if (policy.profile === "managed_process" && permissionMode === "explore") {
    return deny(args, "Explore mode allows read-only shell commands only.")
  }

  if (policy.profile === "unknown_command" && permissionMode === "explore") {
    return deny(args, "Explore mode allows read-only shell commands only.")
  }

  return requireApproval(args, await buildApprovalReview(toolName, args), policy.reason)
}

async function evaluateComputerUseTool(
  toolName: string,
  args: unknown,
  permissionMode: PermissionModeName,
  approvalProvider: CreateToolPermissionRuntimeOptions["computerUseApprovalProvider"]
): Promise<ToolPermissionDecision | null> {
  if (toolName !== "computer_use_action") return null
  if (!isRecord(args)) {
    throw new Error("[ToolPermissionRuntime] Computer Use action args must be an object.")
  }
  if (!approvalProvider) {
    return deny(args, "Computer Use is unavailable without an authorized runtime session.")
  }
  const review = await approvalProvider(args)
  const canonicalArgs: Record<string, unknown> = {
    actions: review.actions,
    sessionId: review.sessionId,
    stateId: review.stateId
  }
  if (permissionMode === "explore") {
    return deny(canonicalArgs, "Explore mode does not allow Computer Use actions.")
  }
  if (permissionMode === "auto") {
    return allow(canonicalArgs, "Auto mode allows Computer Use actions.")
  }
  return requireApproval(
    canonicalArgs,
    review,
    "Confirm mode requires approval before Computer Use can dispatch an action."
  )
}

function isExtensionAgentToolName(toolName: string): boolean {
  try {
    assertExtensionAgentToolName(toolName)
    return true
  } catch {
    return false
  }
}

export function createToolPermissionRuntime(
  options: CreateToolPermissionRuntimeOptions = {}
): ToolPermissionRuntime {
  const permissionMode = options.permissionMode ?? DEFAULT_PERMISSION_MODE

  return {
    async evaluate(request) {
      const toolArgs = isRecord(request.args) ? request.args : {}

      const executeDecision = await evaluateExecuteTool(
        request.toolName,
        request.args,
        permissionMode
      )
      if (executeDecision) {
        return executeDecision
      }

      const computerUseDecision = await evaluateComputerUseTool(
        request.toolName,
        request.args,
        permissionMode,
        options.computerUseApprovalProvider
      )
      if (computerUseDecision) return computerUseDecision

      if (request.toolName === "callExtension") {
        const extensionToolPolicyProvider = options.extensionToolPolicyProvider
        if (!extensionToolPolicyProvider) {
          return deny(
            toolArgs,
            "Extension tool unavailable. Extension tools must be loaded before callExtension can run."
          )
        }

        const extensionCallPolicy = extensionToolPolicyProvider.getCallToolPolicy(toolArgs)
        if (!extensionCallPolicy) {
          return deny(
            toolArgs,
            "Extension tool unavailable. Call loadExtension first, then call a listed extension tool."
          )
        }

        const { decision, toolArgs: extensionToolArgs, binding } = extensionCallPolicy

        if (decision.disposition === "allow") {
          return allow(toolArgs, decision.reason)
        }

        if (decision.disposition === "deny") {
          return deny(toolArgs, decision.reason)
        }

        return requireApproval(
          toolArgs,
          await extensionToolPolicyProvider.getReview(binding, extensionToolArgs),
          decision.reason
        )
      }

      if (isExtensionAgentToolName(request.toolName)) {
        return deny(
          toolArgs,
          "Extension tools must be called through callExtension after the extension is loaded."
        )
      }

      if (!isFileMutationToolName(request.toolName) && !requiresToolApproval(request.toolName)) {
        return allow(toolArgs)
      }

      if (isFileMutationToolName(request.toolName)) {
        if (permissionMode === "explore") {
          return deny(toolArgs, "Explore mode allows read-only file tools only.")
        }

        if (permissionMode === "auto") {
          return allow(toolArgs, "Auto mode allows file mutation tools.")
        }
      }

      return requireApproval(toolArgs, await buildApprovalReview(request.toolName, toolArgs))
    }
  }
}
