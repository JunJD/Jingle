import {
  parseComputerUseSemanticActions,
  type ComputerUseSemanticAction
} from "@jingle/computer-use-core"
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
  reason: string | null
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

export interface ToolApprovalConfirmationFact {
  label: string
  mono?: boolean
  value: string
}

export interface ToolApprovalConfirmation {
  facts: ToolApprovalConfirmationFact[]
  message?: string
  title: string
  tone: "default" | "warning" | "danger"
}

export interface ExtensionToolApprovalItem {
  access: ExtensionToolAccess
  args: Record<string, unknown>
  capabilityDisplayName: string
  capabilityId: string
  confirmation?: ToolApprovalConfirmation
  extensionName: string
  kind: "extension_tool"
  permissionMode: PermissionModeName
  reason: string
  toolName: string
  toolTitle: string
}

export interface ComputerUseToolApprovalItem {
  actions: readonly ComputerUseSemanticAction[]
  kind: "computer_use_action"
  sessionId: string
  stateId: string
  target: ComputerUseToolApprovalTarget
  toolName: "computer_use_action"
}

export interface ComputerUseToolApprovalInput {
  actions: readonly ComputerUseSemanticAction[]
  sessionId: string
  stateId: string
}

export interface ComputerUseToolApprovalElement {
  description?: string
  ref: string
  role: string
  title?: string
}

export interface ComputerUseToolApprovalTarget {
  application: {
    id: string
    name: string
  }
  elements: readonly ComputerUseToolApprovalElement[]
  window: {
    nativeId: string
    platform: "macos" | "windows" | "linux"
  }
}

export type ToolApprovalItem =
  | ComputerUseToolApprovalItem
  | ExecuteToolApprovalItem
  | FileMutationToolApprovalItem
  | ExtensionToolApprovalItem

export interface BuildToolApprovalItemOptions {
  fileMutationChangeType?: MutationChangeType
}

const APPROVAL_REQUIRED_TOOL_NAMES = new Set<string>(["computer_use_action"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key))
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

function readRequiredString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readCanonicalIdentifier(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    return null
  }
  return new TextEncoder().encode(value).byteLength <= 16 * 1024 ? value : null
}

function readBoundedComputerUseText(value: unknown, requireContent: boolean): string | null {
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > 16 * 1024) {
    return null
  }
  return requireContent && value.trim().length === 0 ? null : value
}

function isComputerUsePlatform(
  value: unknown
): value is ComputerUseToolApprovalTarget["window"]["platform"] {
  return value === "macos" || value === "windows" || value === "linux"
}

function parseComputerUseToolApprovalTarget(
  value: unknown,
  actions: readonly ComputerUseSemanticAction[]
): ComputerUseToolApprovalTarget | null {
  if (!isRecord(value) || !hasExactKeys(value, ["application", "elements", "window"])) {
    return null
  }
  if (
    !isRecord(value.application) ||
    !hasExactKeys(value.application, ["id", "name"]) ||
    !isRecord(value.window) ||
    !hasExactKeys(value.window, ["nativeId", "platform"]) ||
    !Array.isArray(value.elements)
  ) {
    return null
  }

  const applicationId = readCanonicalIdentifier(value.application.id)
  const applicationName = readBoundedComputerUseText(value.application.name, true)
  const nativeId = readCanonicalIdentifier(value.window.nativeId)
  if (
    !applicationId ||
    !applicationName ||
    !nativeId ||
    !isComputerUsePlatform(value.window.platform)
  ) {
    return null
  }

  const referencedRefs = [...new Set(actions.map((action) => action.ref))]
  if (value.elements.length !== referencedRefs.length) {
    return null
  }

  const elements: ComputerUseToolApprovalElement[] = []
  for (let index = 0; index < value.elements.length; index += 1) {
    if (!Object.hasOwn(value.elements, index)) return null
    const element = value.elements[index]
    if (!isRecord(element) || !hasExactKeys(element, ["ref", "role"], ["description", "title"])) {
      return null
    }
    const ref = readCanonicalIdentifier(element.ref)
    const role = readCanonicalIdentifier(element.role)
    let description: string | undefined
    if (element.description !== undefined) {
      const parsed = readBoundedComputerUseText(element.description, false)
      if (parsed === null) return null
      description = parsed
    }
    let title: string | undefined
    if (element.title !== undefined) {
      const parsed = readBoundedComputerUseText(element.title, false)
      if (parsed === null) return null
      title = parsed
    }
    if (!ref || !role || ref !== referencedRefs[index]) {
      return null
    }
    elements.push(
      Object.freeze({
        ...(description === undefined ? {} : { description }),
        ref,
        role,
        ...(title === undefined ? {} : { title })
      })
    )
  }

  return Object.freeze({
    application: Object.freeze({ id: applicationId, name: applicationName }),
    elements: Object.freeze(elements),
    window: Object.freeze({ nativeId, platform: value.window.platform })
  })
}

export function parseComputerUseToolApprovalInput(
  value: unknown
): ComputerUseToolApprovalInput | null {
  if (!isRecord(value) || !hasExactKeys(value, ["actions", "sessionId", "stateId"])) {
    return null
  }
  const sessionId = readCanonicalIdentifier(value.sessionId)
  const stateId = readCanonicalIdentifier(value.stateId)
  if (!sessionId || !stateId) return null
  try {
    return Object.freeze({
      actions: parseComputerUseSemanticActions(value.actions, "computer-use approval actions"),
      sessionId,
      stateId
    })
  } catch {
    return null
  }
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function isToolApprovalConfirmationTone(value: unknown): value is ToolApprovalConfirmation["tone"] {
  return value === "default" || value === "warning" || value === "danger"
}

function parseToolApprovalConfirmationFact(value: unknown): ToolApprovalConfirmationFact | null {
  if (!isRecord(value)) {
    return null
  }

  const label = readOptionalString(value.label)
  const factValue = readOptionalString(value.value)
  if (!label || factValue === null) {
    return null
  }

  return {
    label,
    ...(readOptionalBoolean(value.mono) === undefined
      ? {}
      : { mono: readOptionalBoolean(value.mono) }),
    value: factValue
  }
}

function parseToolApprovalConfirmation(value: unknown): ToolApprovalConfirmation | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const title = readOptionalString(value.title)
  if (!title) {
    return undefined
  }

  return {
    facts: Array.isArray(value.facts)
      ? value.facts.flatMap((entry) => {
          const fact = parseToolApprovalConfirmationFact(entry)
          return fact ? [fact] : []
        })
      : [],
    message: readOptionalString(value.message) ?? undefined,
    title,
    tone: isToolApprovalConfirmationTone(value.tone) ? value.tone : "default"
  }
}

function isExecuteCommandProfile(value: unknown): value is ExecuteCommandProfile {
  return (
    value === "read_only" ||
    value === "network_read" ||
    value === "predictable_mutation" ||
    value === "managed_process" ||
    value === "unknown_command" ||
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
    const changes = parseToolApprovalChanges(value.changes)
    if (!Array.isArray(value.changes) || changes.length !== value.changes.length) {
      return null
    }

    return {
      kind: "execute_command",
      toolName: "execute",
      command: readOptionalString(value.command),
      changes,
      profile: isExecuteCommandProfile(value.profile) ? value.profile : null,
      predictionStatus: isMutationPredictionStatus(value.predictionStatus)
        ? value.predictionStatus
        : null,
      reason: readOptionalString(value.reason)
    }
  }

  if (value.kind === "computer_use_action" && value.toolName === "computer_use_action") {
    if (!hasExactKeys(value, ["actions", "kind", "sessionId", "stateId", "target", "toolName"])) {
      return null
    }
    const input = parseComputerUseToolApprovalInput({
      actions: value.actions,
      sessionId: value.sessionId,
      stateId: value.stateId
    })
    if (!input) return null
    const target = parseComputerUseToolApprovalTarget(value.target, input.actions)
    return target
      ? {
          ...input,
          kind: "computer_use_action",
          target,
          toolName: "computer_use_action"
        }
      : null
  }

  if (value.kind === "file_mutation" && isFileMutationToolName(value.toolName)) {
    const changes = parseToolApprovalChanges(value.changes)
    if (!Array.isArray(value.changes) || changes.length !== value.changes.length) {
      return null
    }

    return {
      kind: "file_mutation",
      toolName: value.toolName,
      path: readOptionalString(value.path),
      content: readOptionalString(value.content),
      oldText: readOptionalString(value.oldText),
      newText: readOptionalString(value.newText),
      changes
    }
  }

  if (
    value.kind === "extension_tool" &&
    isExtensionToolAccess(value.access) &&
    isPermissionModeName(value.permissionMode) &&
    isRecord(value.args)
  ) {
    const capabilityDisplayName = readRequiredString(value.capabilityDisplayName)
    const capabilityId = readRequiredString(value.capabilityId)
    const extensionName = readRequiredString(value.extensionName)
    const reason = readRequiredString(value.reason)
    const toolTitle = readRequiredString(value.toolTitle)
    const confirmation = parseToolApprovalConfirmation(value.confirmation)
    if (
      !capabilityDisplayName ||
      !capabilityId ||
      !extensionName ||
      !reason ||
      !toolTitle ||
      (value.confirmation !== undefined && !confirmation)
    ) {
      return null
    }

    return {
      access: value.access,
      args: value.args,
      capabilityDisplayName,
      capabilityId,
      confirmation,
      extensionName,
      kind: "extension_tool",
      permissionMode: value.permissionMode,
      reason,
      toolName: value.toolName,
      toolTitle
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
  if (toolName === "computer_use_action") {
    return null
  }

  if (toolName === "execute") {
    const policy = getExecuteCommandPolicy(args)
    const prediction = getMutationPrediction(args)

    return {
      kind: "execute_command",
      toolName: "execute",
      command: typeof args.command === "string" ? args.command : null,
      changes: prediction?.changes ?? [],
      profile: policy?.profile ?? null,
      predictionStatus: prediction?.status ?? null,
      reason: policy?.reason ?? null
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
