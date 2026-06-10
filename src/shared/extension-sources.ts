import { z } from "zod/v4"
import { isPermissionModeName } from "./permission-mode"
import type { PermissionModeName } from "./permission-mode"
import type {
  NativeExtensionAiCapability,
  NativeExtensionResolvedConnection,
  NativeExtensionSupportedPlatform
} from "./native-extensions"
import { toolCallDisplaySchema, type ToolCallDisplay } from "./tool-presentation"

const localizedTextSchema = z.union([
  z.string().trim().min(1),
  z
    .object({
      en_US: z.string(),
      zh_Hans: z.string()
    })
    .strict()
    .refine((value) => `${value.en_US}${value.zh_Hans}`.trim().length > 0)
])

const toolCallDisplayManifestSchema = z
  .object({
    description: localizedTextSchema,
    title: localizedTextSchema
  })
  .strict()

export {
  DEFAULT_PERMISSION_MODE,
  isPermissionModeName,
  PERMISSION_MODE_NAMES
} from "./permission-mode"
export type { PermissionModeName } from "./permission-mode"

export type ExtensionToolAccess = "read" | "write" | "external"
export type ExtensionPermissionDisposition = "allow" | "require_approval" | "deny"
export type ExtensionAiAuthStatus = "connected" | "missing" | "failed"
export const RUN_EXTENSION_AI_CAPABILITIES_SNAPSHOT_METADATA_KEY = "extensionAiCapabilitiesSnapshot"

export interface ExtensionPermissionDecision {
  access: ExtensionToolAccess
  disposition: ExtensionPermissionDisposition
  mode: PermissionModeName
  reason: string
}

export interface ExtensionToolContext {
  agentToolName?: string
  capabilityId?: string
  connection?: NativeExtensionResolvedConnection
  extensionName: string
  extensionPreferences: Record<string, unknown>
  runId?: string | null
  threadId: string
  toolName: string
  workspacePath: string
}

export interface ExtensionToolSchema<TValue = unknown> {
  parseAsync(value: unknown): Promise<TValue> | TValue
  toJSONSchema?(): unknown
}

export interface ExtensionToolConfirmationFact {
  label: string
  mono?: boolean
  value: string
}

export interface ExtensionToolConfirmationInfoFact {
  mono?: boolean
  name: string
  value: string
}

export interface ExtensionToolConfirmation {
  facts?: ExtensionToolConfirmationFact[]
  info?: ExtensionToolConfirmationInfoFact[]
  message?: string
  title?: string
  tone?: "default" | "warning" | "danger"
}

export interface ExtensionToolConfirmationContext extends ExtensionToolContext {
  access: ExtensionToolAccess
  capabilityDisplayName: string
  permissionMode: PermissionModeName
  toolTitle: string
}

export type ExtensionToolConfirmationBuilder = (
  input: unknown,
  context: ExtensionToolConfirmationContext
) => Promise<ExtensionToolConfirmation> | ExtensionToolConfirmation

export interface ExtensionToolApprovalDefinition {
  confirmation?: ExtensionToolConfirmationBuilder
  riskLabel?: "write" | "external" | "destructive"
}

const nonEmptyTrimmedStringSchema = z.string().trim().min(1)
const optionalTrimmedStringSchema = nonEmptyTrimmedStringSchema.optional()
const optionalNullableTrimmedStringSchema = z
  .union([z.null(), nonEmptyTrimmedStringSchema])
  .optional()

export const extensionToolOutputBaseSchema = z.object({
  dedupeKey: optionalTrimmedStringSchema,
  subtitle: optionalNullableTrimmedStringSchema
})

export const extensionToolFileOutputSchema = extensionToolOutputBaseSchema.extend({
  kind: z.literal("file"),
  mimeType: optionalNullableTrimmedStringSchema,
  path: nonEmptyTrimmedStringSchema,
  previewText: optionalNullableTrimmedStringSchema,
  title: optionalTrimmedStringSchema
})

export const extensionToolPatchOutputSchema = extensionToolOutputBaseSchema.extend({
  kind: z.literal("patch"),
  mimeType: optionalNullableTrimmedStringSchema,
  patchText: nonEmptyTrimmedStringSchema,
  previewText: optionalNullableTrimmedStringSchema,
  title: optionalTrimmedStringSchema
})

export const extensionToolLinkOutputSchema = extensionToolOutputBaseSchema.extend({
  kind: z.literal("link"),
  previewText: optionalNullableTrimmedStringSchema,
  title: nonEmptyTrimmedStringSchema,
  url: nonEmptyTrimmedStringSchema
})

export const extensionToolSummaryOutputSchema = extensionToolOutputBaseSchema.extend({
  format: z.enum(["markdown", "plain"]).optional(),
  kind: z.literal("summary"),
  text: nonEmptyTrimmedStringSchema,
  title: nonEmptyTrimmedStringSchema
})

export const extensionToolOutputSchema = z.discriminatedUnion("kind", [
  extensionToolFileOutputSchema,
  extensionToolPatchOutputSchema,
  extensionToolLinkOutputSchema,
  extensionToolSummaryOutputSchema
])

export const extensionToolOutputListSchema = z.array(extensionToolOutputSchema).min(1)

export const extensionToolOutputEnvelopeSchema = z.object({
  artifacts: extensionToolOutputListSchema
})

export type ExtensionToolOutputBase = z.infer<typeof extensionToolOutputBaseSchema>
export type ExtensionToolFileOutput = z.infer<typeof extensionToolFileOutputSchema>
export type ExtensionToolPatchOutput = z.infer<typeof extensionToolPatchOutputSchema>
export type ExtensionToolLinkOutput = z.infer<typeof extensionToolLinkOutputSchema>
export type ExtensionToolSummaryOutput = z.infer<typeof extensionToolSummaryOutputSchema>
export type ExtensionToolOutput = z.infer<typeof extensionToolOutputSchema>
export type ExtensionToolOutputEnvelope = z.infer<typeof extensionToolOutputEnvelopeSchema>

export interface ExtensionToolOutputContext<TInput = unknown> extends ExtensionToolContext {
  input: TInput
}

export type ExtensionToolOutputsBuilder<TInput = unknown, TOutput = unknown> = (
  output: TOutput,
  context: ExtensionToolOutputContext<TInput>
) => Promise<ExtensionToolOutput[]> | ExtensionToolOutput[]

export interface ExtensionToolDefinition<TInput = unknown, TOutput = unknown> {
  access: ExtensionToolAccess
  approval?: ExtensionToolApprovalDefinition
  outputs?(
    output: TOutput,
    context: ExtensionToolOutputContext<TInput>
  ): Promise<ExtensionToolOutput[]> | ExtensionToolOutput[]
  description: string
  inputSchema: ExtensionToolSchema<TInput>
  name: string
  outputSchema?: ExtensionToolSchema<TOutput>
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

export interface ExtensionAiCapabilityCatalogToolSummary {
  access?: ExtensionToolAccess
  description: string
  title: string
  toolName: string
}

export interface ExtensionAiCapabilityCatalogItem {
  description: string
  extensionName: string
  guide: string
  mention?: {
    label: string
    value: string
  }
  sourceId: string
  supportedPlatforms?: NativeExtensionSupportedPlatform[]
  title: string
  toolNames: string[]
  tools: ExtensionAiCapabilityCatalogToolSummary[]
}

export interface ResolvedExtensionAiCapability {
  authStatus: ExtensionAiAuthStatus
  capability: ExtensionAiCapability
  capabilityTitle?: string
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
    connectionId: z.string().trim().min(1).optional(),
    description: localizedTextSchema.optional(),
    guide: z.string().trim().min(1),
    id: z.string().trim().min(1),
    instructions: z.array(z.string().trim().min(1)).optional(),
    mention: z
      .object({
        label: localizedTextSchema.optional(),
        value: z.string().trim().min(1).optional()
      })
      .strict()
      .optional(),
    permissionMode: z.custom<PermissionModeName>(isPermissionModeName).optional(),
    publicPreferenceNames: z.array(z.string().trim().min(1)).optional(),
    requiredPreferenceNames: z.array(z.string().trim().min(1)).optional(),
    supportedPlatforms: z.array(z.enum(["darwin", "linux", "win32"])).optional(),
    title: localizedTextSchema,
    toolDisplays: z.record(z.string(), toolCallDisplayManifestSchema).optional(),
    toolNames: z.array(z.string().trim().min(1))
  })
  .strict()

export const resolvedExtensionAiCapabilitySchema = z
  .object({
    authStatus: z.enum(["connected", "missing", "failed"]),
    capability: extensionAiCapabilitySchema,
    capabilityTitle: z.string().trim().min(1).optional(),
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
    permissionModeSnapshot: resolvedCapability.permissionMode,
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
      publicConfigSnapshot: isRecord(entry.publicConfigSnapshot) ? entry.publicConfigSnapshot : {},
      runId
    })
  }

  return snapshots
}

export function parseExtensionAiCapability(value: unknown): ExtensionAiCapability | null {
  const parsed = extensionAiCapabilitySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseExtensionSourceMention(value: unknown): ExtensionSourceMention | null {
  const parsed = extensionSourceMentionSchema.safeParse(value)
  return parsed.success ? parsed.data : null
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
