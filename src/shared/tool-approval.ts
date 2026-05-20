import type { ExecuteCommandProfile } from "./execute-command-policy"
import { getExecuteCommandPolicy } from "./execute-command-policy"
import type { ExtensionToolAccess } from "./extension-sources"
import { isPermissionModeName, type PermissionModeName } from "./permission-mode"
import {
  getFileMutationReview,
  isFileMutationToolName,
  type FileMutationToolName
} from "./file-mutation-review"
import {
  getMutationPrediction,
  type MutationChangeType,
  type MutationPredictionStatus
} from "./mutation-prediction"

export interface ToolApprovalChange {
  path: string
  changeType: MutationChangeType
}

export interface ExecuteToolApprovalItem {
  kind: "execute_command"
  toolName: "execute"
  command: string | null
  changes: ToolApprovalChange[]
  profile: ExecuteCommandProfile | null
  predictionStatus: MutationPredictionStatus | null
}

export interface FileMutationToolApprovalItem {
  kind: "file_mutation"
  toolName: FileMutationToolName
  path: string | null
  content: string | null
  oldText: string | null
  newText: string | null
  changes: ToolApprovalChange[]
}

export interface ExtensionToolApprovalItem {
  access: ExtensionToolAccess
  args: Record<string, unknown>
  extensionName: string
  kind: "extension_tool"
  permissionMode: PermissionModeName
  reason: string
  sourceDisplayName: string
  sourceId: string
  sourceProfileId: string
  toolName: string
  toolTitle: string
}

export type ToolApprovalItem =
  | ExecuteToolApprovalItem
  | FileMutationToolApprovalItem
  | ExtensionToolApprovalItem

export interface BuildToolApprovalItemOptions {
  fileMutationChangeType?: MutationChangeType
}

const APPROVAL_REQUIRED_TOOL_NAMES = new Set<string>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isMutationChangeType(value: unknown): value is MutationChangeType {
  return value === "create" || value === "modify" || value === "delete"
}

function isMutationPredictionStatus(value: unknown): value is MutationPredictionStatus {
  return (
    value === "predicted" ||
    value === "command_failed" ||
    value === "unsupported_command" ||
    value === "simulation_error" ||
    value === "timed_out" ||
    value === "unsupported_platform"
  )
}

function parseToolApprovalChanges(value: unknown): ToolApprovalChange[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        if (
          !isRecord(entry) ||
          typeof entry.path !== "string" ||
          !isMutationChangeType(entry.changeType)
        ) {
          return []
        }

        return [
          {
            path: entry.path,
            changeType: entry.changeType
          }
        ]
      })
    : []
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function isExecuteCommandProfile(value: unknown): value is ExecuteCommandProfile {
  return (
    value === "read_only" ||
    value === "network_read" ||
    value === "predictable_mutation" ||
    value === "managed_process" ||
    value === "host_unsafe"
  )
}

function isExtensionToolAccess(value: unknown): value is ExtensionToolAccess {
  return value === "read" || value === "write" || value === "external"
}

export function requiresToolApproval(toolName: string): boolean {
  return APPROVAL_REQUIRED_TOOL_NAMES.has(toolName)
}

export function parseToolApprovalItem(value: unknown): ToolApprovalItem | null {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.toolName !== "string") {
    return null
  }

  if (value.kind === "execute_command" && value.toolName === "execute") {
    return {
      kind: "execute_command",
      toolName: "execute",
      command: readOptionalString(value.command),
      changes: parseToolApprovalChanges(value.changes),
      profile: isExecuteCommandProfile(value.profile) ? value.profile : null,
      predictionStatus: isMutationPredictionStatus(value.predictionStatus)
        ? value.predictionStatus
        : null
    }
  }

  if (value.kind === "file_mutation" && isFileMutationToolName(value.toolName)) {
    return {
      kind: "file_mutation",
      toolName: value.toolName,
      path: readOptionalString(value.path),
      content: readOptionalString(value.content),
      oldText: readOptionalString(value.oldText),
      newText: readOptionalString(value.newText),
      changes: parseToolApprovalChanges(value.changes)
    }
  }

  if (
    value.kind === "extension_tool" &&
    isExtensionToolAccess(value.access) &&
    isPermissionModeName(value.permissionMode) &&
    isRecord(value.args)
  ) {
    return {
      access: value.access,
      args: value.args,
      extensionName: readOptionalString(value.extensionName) ?? "",
      kind: "extension_tool",
      permissionMode: value.permissionMode,
      reason: readOptionalString(value.reason) ?? "",
      sourceDisplayName: readOptionalString(value.sourceDisplayName) ?? "",
      sourceId: readOptionalString(value.sourceId) ?? "",
      sourceProfileId: readOptionalString(value.sourceProfileId) ?? "",
      toolName: value.toolName,
      toolTitle: readOptionalString(value.toolTitle) ?? value.toolName
    }
  }

  return null
}

export function buildExtensionToolApprovalItem(
  input: Omit<ExtensionToolApprovalItem, "args" | "kind">,
  args: Record<string, unknown>
): ExtensionToolApprovalItem {
  return {
    ...input,
    args,
    kind: "extension_tool"
  }
}

export function buildToolApprovalItem(
  toolName: string,
  args: Record<string, unknown>,
  options?: BuildToolApprovalItemOptions
): ToolApprovalItem | null {
  if (toolName === "execute") {
    const policy = getExecuteCommandPolicy(args)
    const prediction = getMutationPrediction(args)

    return {
      kind: "execute_command",
      toolName: "execute",
      command: typeof args.command === "string" ? args.command : null,
      changes: prediction?.changes ?? [],
      profile: policy?.profile ?? null,
      predictionStatus: prediction?.status ?? null
    }
  }

  const review = getFileMutationReview(toolName, args)
  if (!review) {
    return null
  }

  return {
    kind: "file_mutation",
    toolName: review.toolName,
    path: review.path,
    content: review.content,
    oldText: review.oldText,
    newText: review.newText,
    changes: review.path
      ? [
          {
            path: review.path,
            changeType: options?.fileMutationChangeType ?? "modify"
          }
        ]
      : []
  }
}
