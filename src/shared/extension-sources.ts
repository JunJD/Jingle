import { z, type ZodType } from "zod/v4"
import { isPermissionModeName } from "./permission-mode"
import type { PermissionModeName } from "./permission-mode"
import { toolCallDisplaySchema, type ToolCallDisplay } from "./tool-presentation"

export {
  DEFAULT_PERMISSION_MODE,
  isPermissionModeName,
  PERMISSION_MODE_NAMES
} from "./permission-mode"
export type { PermissionModeName } from "./permission-mode"

export type ExtensionToolAccess = "read" | "write" | "external"
export type ExtensionPermissionDisposition = "allow" | "require_approval" | "deny"
export const RUN_SOURCE_BINDINGS_SNAPSHOT_METADATA_KEY = "runSourceBindingsSnapshot"
export const RUN_SOURCE_PROFILES_SNAPSHOT_METADATA_KEY = "sourceProfilesSnapshot"

export interface ExtensionPermissionDecision {
  access: ExtensionToolAccess
  disposition: ExtensionPermissionDisposition
  mode: PermissionModeName
  reason: string
}

export interface ExtensionToolContext {
  agentToolName?: string
  extensionName: string
  runId?: string | null
  sourceId?: string
  sourceProfileId?: string
  threadId: string
  toolName: string
  workspacePath: string
}

export interface ExtensionToolDefinition<TInput = unknown, TOutput = unknown> {
  access: ExtensionToolAccess
  description: string
  inputSchema: ZodType<TInput>
  name: string
  outputSchema?: ZodType<TOutput>
  title: string
  handler(ctx: ExtensionToolContext, input: TInput): Promise<TOutput> | TOutput
}

export interface ExtensionSourceDefinition {
  defaultToolNames: string[]
  description: string
  extensionName: string
  guide: string
  id: string
  requiredPreferenceNames?: string[]
  supportsMultipleProfiles?: boolean
  title: string
  writeToolNames?: string[]
}

export interface SourceProfile {
  authStatus: "connected" | "missing" | "failed"
  createdAt: string
  defaultPermissionMode: PermissionModeName
  displayName: string
  enabled: boolean
  enabledTools: ExtensionSourceProfileTool[]
  enabledToolNames: string[]
  extensionName: string
  id: string
  /** Non-secret profile settings that are safe to persist in run evidence. */
  publicConfig: Record<string, unknown>
  sourceId: string
  updatedAt: string
}

export interface RunSourceBinding {
  authStateSnapshot: string
  createdAt: string
  displayNameSnapshot: string
  enabledToolNamesSnapshot: string[]
  extensionName: string
  id: string
  permissionModeSnapshot: PermissionModeName
  runId: string
  sourceId: string
  sourceProfileId: string
  sourceVersion: string
}

export interface ExtensionSourceBinding {
  profile: SourceProfile
  source: ExtensionSourceDefinition
}

const AGENT_TOOL_NAME_PREFIX = "ext"
const AGENT_TOOL_NAME_SEPARATOR = "__"
const AGENT_TOOL_NAME_SEGMENT_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/

export type ExtensionAgentToolDisplay = ToolCallDisplay

export interface ExtensionSourceProfileTool {
  agentToolName: string
  display: ExtensionAgentToolDisplay
  toolName: string
}

function assertAgentToolNameSegment(label: string, value: string): void {
  if (!AGENT_TOOL_NAME_SEGMENT_PATTERN.test(value)) {
    throw new Error(
      `${label} "${value}" must start with a letter and contain only letters, numbers, or underscores.`
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === "string")
}

function parseMetadataValue(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {}
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function assertExtensionAgentToolName(agentToolName: string): void {
  const parts = agentToolName.split(AGENT_TOOL_NAME_SEPARATOR)
  if (parts.length < 2 || parts[0] !== AGENT_TOOL_NAME_PREFIX) {
    throw new Error(
      `Agent tool name "${agentToolName}" must start with "${AGENT_TOOL_NAME_PREFIX}${AGENT_TOOL_NAME_SEPARATOR}".`
    )
  }

  for (const part of parts) {
    assertAgentToolNameSegment("Agent tool name segment", part)
  }
}

export const extensionSourceProfileToolSchema = z
  .object({
    agentToolName: z.string().trim().min(1),
    display: toolCallDisplaySchema,
    toolName: z.string().trim().min(1)
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      assertExtensionAgentToolName(value.agentToolName)
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid extension agent tool name.",
        path: ["agentToolName"]
      })
    }
  })

export const extensionSourceProfileToolsSchema = z.array(extensionSourceProfileToolSchema)

function parseEnabledTools(value: unknown): ExtensionSourceProfileTool[] {
  const parsed = extensionSourceProfileToolsSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

export function resolveExtensionToolPermission(input: {
  access: ExtensionToolAccess
  mode: PermissionModeName
}): ExtensionPermissionDecision {
  if (input.mode === "explore" && input.access !== "read") {
    return {
      access: input.access,
      disposition: "deny",
      mode: input.mode,
      reason: "Explore mode allows read-only extension tools only."
    }
  }

  if (input.mode === "ask-to-edit" && input.access !== "read") {
    return {
      access: input.access,
      disposition: "require_approval",
      mode: input.mode,
      reason: "Ask to Edit mode requires approval for write and external extension tools."
    }
  }

  if (input.access === "read") {
    return {
      access: input.access,
      disposition: "allow",
      mode: input.mode,
      reason: "Read-only extension tool is allowed."
    }
  }

  return {
    access: input.access,
    disposition: "allow",
    mode: input.mode,
    reason: "Auto mode allows extension tools."
  }
}

export function snapshotSourceProfiles(sourceBindings: ExtensionSourceBinding[]): SourceProfile[] {
  return sourceBindings.map((binding) => ({
    ...binding.profile,
    enabledTools: structuredClone(binding.profile.enabledTools),
    enabledToolNames: [...binding.profile.enabledToolNames],
    publicConfig: structuredClone(binding.profile.publicConfig)
  }))
}

export function createRunSourceBindingsSnapshot(input: {
  now?: string
  permissionMode: PermissionModeName
  runId: string
  sourceBindings: ExtensionSourceBinding[]
}): RunSourceBinding[] {
  const createdAt = input.now ?? new Date().toISOString()

  return input.sourceBindings.map((binding) => ({
    authStateSnapshot: binding.profile.authStatus,
    createdAt,
    displayNameSnapshot: binding.profile.displayName,
    enabledToolNamesSnapshot: [...binding.profile.enabledToolNames],
    extensionName: binding.source.extensionName,
    id: `${input.runId}:${binding.profile.id}`,
    permissionModeSnapshot: input.permissionMode,
    runId: input.runId,
    sourceId: binding.source.id,
    sourceProfileId: binding.profile.id,
    sourceVersion: "1"
  }))
}

export function parseSourceProfilesSnapshot(value: unknown): SourceProfile[] {
  if (!Array.isArray(value)) {
    return []
  }

  const profiles: SourceProfile[] = []

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue
    }

    const id = readString(entry.id)
    const sourceId = readString(entry.sourceId)
    const extensionName = readString(entry.extensionName)
    const displayName = readString(entry.displayName)
    const createdAt = readString(entry.createdAt)
    const updatedAt = readString(entry.updatedAt)
    const authStatus = readString(entry.authStatus)
    const defaultPermissionMode = entry.defaultPermissionMode

    if (
      !id ||
      !sourceId ||
      !extensionName ||
      !displayName ||
      !createdAt ||
      !updatedAt ||
      (authStatus !== "connected" && authStatus !== "missing" && authStatus !== "failed") ||
      !isPermissionModeName(defaultPermissionMode)
    ) {
      continue
    }

    profiles.push({
      authStatus,
      createdAt,
      defaultPermissionMode,
      displayName,
      enabled: entry.enabled === true,
      enabledTools: parseEnabledTools(entry.enabledTools),
      enabledToolNames: readStringArray(entry.enabledToolNames),
      extensionName,
      id,
      publicConfig: isRecord(entry.publicConfig) ? entry.publicConfig : {},
      sourceId,
      updatedAt
    })
  }

  return profiles
}

export function readSourceProfilesSnapshotFromMetadata(
  metadata: string | null | undefined
): SourceProfile[] | null {
  const parsed = parseMetadataValue(metadata)
  if (!Object.prototype.hasOwnProperty.call(parsed, RUN_SOURCE_PROFILES_SNAPSHOT_METADATA_KEY)) {
    return null
  }

  return parseSourceProfilesSnapshot(parsed[RUN_SOURCE_PROFILES_SNAPSHOT_METADATA_KEY])
}
