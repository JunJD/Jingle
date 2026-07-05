import { lstat } from "node:fs/promises"
import { getExecuteCommandPolicy } from "@shared/execute-command-policy"
import type { MutationChangeType } from "@shared/mutation-prediction"
import { DEFAULT_PERMISSION_MODE, type PermissionModeName } from "@shared/permission-mode"
import {
  buildToolApprovalItem,
  requiresToolApproval,
  type ToolApprovalItem
} from "@shared/tool-approval"
import { getFileMutationReview, isFileMutationToolName } from "@shared/file-mutation-review"
import { assertExtensionAgentToolName } from "@shared/extension-sources"
import { getAgentConfig } from "../preferences"
import type { AgentConfig } from "../types"
import { getDesktopAutomationPolicyDecision } from "./desktop-automation-policy"
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
  extensionToolPolicyProvider?: ExtensionToolApprovalPolicyProvider
  getAgentConfig?: () => AgentConfig
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
  review: ToolApprovalItem | null,
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
): Promise<ToolApprovalItem | null> {
  const fileMutationChangeType = isFileMutationToolName(toolName)
    ? await resolveFileMutationChangeType(toolName, args)
    : undefined

  return buildToolApprovalItem(toolName, args, {
    fileMutationChangeType: fileMutationChangeType ?? undefined
  })
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
  const readAgentConfig = options.getAgentConfig ?? getAgentConfig
  const permissionMode = options.permissionMode ?? DEFAULT_PERMISSION_MODE

  return {
    async evaluate(request) {
      const toolArgs = isRecord(request.args) ? request.args : {}

      const desktopAutomationDecision = getDesktopAutomationPolicyDecision(
        request.toolName,
        toolArgs,
        readAgentConfig()
      )

      if (desktopAutomationDecision?.disposition === "allow") {
        return allow(toolArgs, desktopAutomationDecision.reason)
      }

      if (desktopAutomationDecision?.disposition === "deny") {
        return deny(toolArgs, desktopAutomationDecision.reason)
      }

      if (desktopAutomationDecision?.disposition === "require_approval") {
        return requireApproval(toolArgs, null, desktopAutomationDecision.reason)
      }

      const executeDecision = await evaluateExecuteTool(
        request.toolName,
        request.args,
        permissionMode
      )
      if (executeDecision) {
        return executeDecision
      }

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
