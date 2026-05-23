import { z, type ZodType } from "zod/v4"
import { isPermissionModeName } from "./permission-mode"
import type { PermissionModeName } from "./permission-mode"
import type {
  NativeExtensionAiCapability,
  NativeExtensionSupportedPlatform
} from "./native-extensions"
import { toolCallDisplaySchema, type ToolCallDisplay } from "./tool-presentation"

export {
  DEFAULT_PERMISSION_MODE,
  isPermissionModeName,
  PERMISSION_MODE_NAMES
} from "./permission-mode"
export type { PermissionModeName } from "./permission-mode"

export type ExtensionToolAccess = "read" | "write" | "external"
export type ExtensionPermissionDisposition = "allow" | "require_approval" | "deny"
export type ExtensionAiAuthStatus = "connected" | "missing" | "failed"
export const RUN_EXTENSION_AI_CAPABILITIES_SNAPSHOT_METADATA_KEY =
  "extensionAiCapabilitiesSnapshot"
export const LEGACY_SOURCE_PROFILES_SNAPSHOT_METADATA_KEY = "sourceProfilesSnapshot"

export interface ExtensionPermissionDecision {
  access: ExtensionToolAccess
  disposition: ExtensionPermissionDisposition
  mode: PermissionModeName
  reason: string
}

export interface ExtensionToolContext {
  agentToolName?: string
  capabilityId?: string
  extensionName: string
  runId?: string | null
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

export type ExtensionAiCapability = NativeExtensionAiCapability
export type ExtensionAgentToolDisplay = ToolCallDisplay

export interface ExtensionAiCapabilityTool {
  agentToolName: string
  display: ExtensionAgentToolDisplay
  toolName: string
}

export interface ResolvedExtensionAiCapability {
  authStatus: ExtensionAiAuthStatus
  capability: ExtensionAiCapability
  displayName: string
  enabled: boolean
  enabledToolNames: string[]
  extensionName: string
  iconName?: string
  permissionMode: PermissionModeName
  publicConfig: Record<string, unknown>
  toolExposures: ExtensionAiCapabilityTool[]
}

export interface RunExtensionAiCapabilitySnapshot {
  authStateSnapshot: ExtensionAiAuthStatus
  capabilityId: string
  capabilityVersion: string
  createdAt: string
  displayNameSnapshot: string
  enabledSnapshot: boolean
  enabledToolNamesSnapshot: string[]
  extensionName: string
  id: string
  permissionModeSnapshot: PermissionModeName
  publicConfigSnapshot: Record<string, unknown>
  runId: string
}

export interface ExtensionSourceMention {
  extensionName: string
  icon?: string
  iconName?: string
  label: string
  supportedPlatforms?: NativeExtensionSupportedPlatform[]
  sourceId: string
  value: string
}

export interface LegacySourceProfileSnapshot {
  authStatus: ExtensionAiAuthStatus
  createdAt: string
  defaultPermissionMode: PermissionModeName
  displayName: string
  enabled: boolean
  enabledTools: ExtensionAiCapabilityTool[]
  enabledToolNames: string[]
  extensionName: string
  id: string
  /** Non-secret profile settings that are safe to persist in run evidence. */
  publicConfig: Record<string, unknown>
  sourceId: string
  updatedAt: string
}

const AGENT_TOOL_NAME_PREFIX = "ext"
const AGENT_TOOL_NAME_SEPARATOR = "__"
const AGENT_TOOL_NAME_SEGMENT_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/

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

export const extensionAiCapabilityToolSchema = z
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

export const extensionAiCapabilityToolsSchema = z.array(extensionAiCapabilityToolSchema)

export const extensionAiCapabilitySchema = z
  .object({
    description: z.string().trim().min(1).optional(),
    guide: z.string().trim().min(1),
    id: z.string().trim().min(1),
    instructions: z.array(z.string().trim().min(1)).optional(),
    mention: z
      .object({
        label: z.string().trim().min(1).optional(),
        value: z.string().trim().min(1).optional()
      })
      .strict()
      .optional(),
    publicPreferenceNames: z.array(z.string().trim().min(1)).optional(),
    requiredPreferenceNames: z.array(z.string().trim().min(1)).optional(),
    supportedPlatforms: z.array(z.enum(["darwin", "linux", "win32"])).optional(),
    title: z.string().trim().min(1),
    toolDisplays: z.record(z.string(), toolCallDisplaySchema).optional(),
    toolNames: z.array(z.string().trim().min(1))
  })
  .strict()

export const resolvedExtensionAiCapabilitySchema = z
  .object({
    authStatus: z.enum(["connected", "missing", "failed"]),
    capability: extensionAiCapabilitySchema,
    displayName: z.string().trim().min(1),
    enabled: z.boolean(),
    enabledToolNames: z.array(z.string().trim().min(1)),
    extensionName: z.string().trim().min(1),
    iconName: z.string().trim().min(1).optional(),
    permissionMode: z.custom<PermissionModeName>(isPermissionModeName),
    publicConfig: z.record(z.string(), z.unknown()),
    toolExposures: extensionAiCapabilityToolsSchema
  })
  .strict()

export const legacySourceProfileSnapshotSchema = z
  .object({
    authStatus: z.enum(["connected", "missing", "failed"]),
    createdAt: z.string().trim().min(1),
    defaultPermissionMode: z.custom<PermissionModeName>(isPermissionModeName),
    displayName: z.string().trim().min(1),
    enabled: z.boolean(),
    enabledTools: extensionAiCapabilityToolsSchema,
    enabledToolNames: z.array(z.string().trim().min(1)),
    extensionName: z.string().trim().min(1),
    id: z.string().trim().min(1),
    publicConfig: z.record(z.string(), z.unknown()),
    sourceId: z.string().trim().min(1),
    updatedAt: z.string().trim().min(1)
  })
  .strict()

export const extensionSourceMentionSchema = z
  .object({
    extensionName: z.string().trim().min(1),
    iconName: z.string().trim().min(1),
    label: z.string().trim().min(1),
    sourceId: z.string().trim().min(1),
    supportedPlatforms: z.array(z.enum(["darwin", "linux", "win32"])).optional(),
    value: z.string().trim().min(1)
  })
  .strict()

function parseEnabledTools(value: unknown): ExtensionAiCapabilityTool[] {
  const parsed = extensionAiCapabilityToolsSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

function parseAuthStatus(value: unknown): ExtensionAiAuthStatus | null {
  return value === "connected" || value === "missing" || value === "failed" ? value : null
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

export function createRunExtensionAiCapabilitiesSnapshot(input: {
  aiCapabilities: ResolvedExtensionAiCapability[]
  now?: string
  permissionMode: PermissionModeName
  runId: string
}): RunExtensionAiCapabilitySnapshot[] {
  const createdAt = input.now ?? new Date().toISOString()

  return input.aiCapabilities.map((resolvedCapability) => ({
    authStateSnapshot: resolvedCapability.authStatus,
    capabilityId: resolvedCapability.capability.id,
    capabilityVersion: "1",
    createdAt,
    displayNameSnapshot: resolvedCapability.displayName,
    enabledSnapshot: resolvedCapability.enabled,
    enabledToolNamesSnapshot: [...resolvedCapability.enabledToolNames],
    extensionName: resolvedCapability.extensionName,
    id: `${input.runId}:${resolvedCapability.extensionName}:${resolvedCapability.capability.id}`,
    permissionModeSnapshot: input.permissionMode,
    publicConfigSnapshot: structuredClone(resolvedCapability.publicConfig),
    runId: input.runId
  }))
}

export function parseRunExtensionAiCapabilitiesSnapshot(
  value: unknown
): RunExtensionAiCapabilitySnapshot[] {
  if (!Array.isArray(value)) {
    return []
  }

  const snapshots: RunExtensionAiCapabilitySnapshot[] = []

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue
    }

    const id = readString(entry.id)
    const runId = readString(entry.runId)
    const capabilityId = readString(entry.capabilityId)
    const extensionName = readString(entry.extensionName)
    const displayNameSnapshot = readString(entry.displayNameSnapshot)
    const authStateSnapshot = parseAuthStatus(entry.authStateSnapshot)
    const permissionModeSnapshot = entry.permissionModeSnapshot
    const capabilityVersion = readString(entry.capabilityVersion)
    const createdAt = readString(entry.createdAt)

    if (
      !id ||
      !runId ||
      !capabilityId ||
      !extensionName ||
      !displayNameSnapshot ||
      !authStateSnapshot ||
      !isPermissionModeName(permissionModeSnapshot) ||
      !capabilityVersion ||
      !createdAt
    ) {
      continue
    }

    snapshots.push({
      authStateSnapshot,
      capabilityId,
      capabilityVersion,
      createdAt,
      displayNameSnapshot,
      enabledSnapshot: entry.enabledSnapshot !== false,
      enabledToolNamesSnapshot: readStringArray(entry.enabledToolNamesSnapshot),
      extensionName,
      id,
      permissionModeSnapshot,
      publicConfigSnapshot: isRecord(entry.publicConfigSnapshot)
        ? entry.publicConfigSnapshot
        : {},
      runId
    })
  }

  return snapshots
}

export function parseLegacySourceProfilesSnapshot(value: unknown): LegacySourceProfileSnapshot[] {
  if (!Array.isArray(value)) {
    return []
  }

  const profiles: LegacySourceProfileSnapshot[] = []

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

export function parseExtensionAiCapability(value: unknown): ExtensionAiCapability | null {
  const parsed = extensionAiCapabilitySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseExtensionSourceMention(value: unknown): ExtensionSourceMention | null {
  const parsed = extensionSourceMentionSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseLegacySourceProfileSnapshot(
  value: unknown
): LegacySourceProfileSnapshot | null {
  const parsed = legacySourceProfileSnapshotSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function readLegacySourceProfilesSnapshotFromMetadata(
  metadata: string | null | undefined
): LegacySourceProfileSnapshot[] | null {
  const parsed = parseMetadataValue(metadata)
  if (!Object.prototype.hasOwnProperty.call(parsed, LEGACY_SOURCE_PROFILES_SNAPSHOT_METADATA_KEY)) {
    return null
  }

  return parseLegacySourceProfilesSnapshot(parsed[LEGACY_SOURCE_PROFILES_SNAPSHOT_METADATA_KEY])
}

export function readRunExtensionAiCapabilitiesSnapshotFromMetadata(
  metadata: string | null | undefined
): RunExtensionAiCapabilitySnapshot[] | null {
  const parsed = parseMetadataValue(metadata)
  if (
    !Object.prototype.hasOwnProperty.call(
      parsed,
      RUN_EXTENSION_AI_CAPABILITIES_SNAPSHOT_METADATA_KEY
    )
  ) {
    return null
  }

  return parseRunExtensionAiCapabilitiesSnapshot(
    parsed[RUN_EXTENSION_AI_CAPABILITIES_SNAPSHOT_METADATA_KEY]
  )
}
