export const OPENWORK_MEMORY_TYPES = ["about_me", "workspace_context", "correction"] as const
export const OPENWORK_MEMORY_SCOPES = ["global", "workspace"] as const
export const OPENWORK_MEMORY_STATUSES = ["active", "archived"] as const
export const OPENWORK_MEMORY_SUGGESTION_STATUSES = ["pending", "accepted", "rejected"] as const
export const OPENWORK_MEMORY_SOURCES = ["user", "agent_suggestion"] as const
export const OPENWORK_MEMORY_CONTEXT_KINDS = [
  "soul",
  "rules",
  "instruction_source",
  "about_me",
  "workspace_context",
  "correction"
] as const
export const OPENWORK_MEMORY_CONTEXT_SNAPSHOT_METADATA_KEY = "openworkMemoryContextSnapshot"
export const OPENWORK_MEMORY_TEMPORARY_MODE_METADATA_KEY = "openworkMemoryTemporaryMode"

export type OpenworkMemoryType = (typeof OPENWORK_MEMORY_TYPES)[number]
export type OpenworkMemoryScope = (typeof OPENWORK_MEMORY_SCOPES)[number]
export type OpenworkMemoryStatus = (typeof OPENWORK_MEMORY_STATUSES)[number]
export type OpenworkMemorySuggestionStatus = (typeof OPENWORK_MEMORY_SUGGESTION_STATUSES)[number]
export type OpenworkMemorySource = (typeof OPENWORK_MEMORY_SOURCES)[number]
export type OpenworkMemoryContextKind = (typeof OPENWORK_MEMORY_CONTEXT_KINDS)[number]

export interface OpenworkWorkspaceIdentity {
  canonicalWorkspacePath: string
  displayName: string
  gitRoot?: string
  workspaceKey: string
  worktreeRoot?: string
}

export interface OpenworkMemorySettings {
  askBeforeSaving: boolean
  showIncludedMemories: boolean
  useMemory: boolean
}

export const DEFAULT_OPENWORK_MEMORY_SETTINGS: OpenworkMemorySettings = {
  askBeforeSaving: true,
  showIncludedMemories: true,
  useMemory: true
}

export function normalizeOpenworkMemorySettings(value: unknown): OpenworkMemorySettings {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<OpenworkMemorySettings> & { showUsedMemories?: boolean })
      : {}
  const showIncludedMemories = raw.showIncludedMemories ?? raw.showUsedMemories

  return {
    askBeforeSaving: true,
    showIncludedMemories: showIncludedMemories !== false,
    useMemory: raw.useMemory !== false
  }
}

export interface OpenworkMemoryRecord {
  content: string
  createdAt: number
  lastIncludedAt: number | null
  memoryId: string
  metadata: Record<string, unknown> | null
  scope: OpenworkMemoryScope
  source: OpenworkMemorySource
  status: OpenworkMemoryStatus
  type: OpenworkMemoryType
  updatedAt: number
  workspaceKey: string | null
}

export interface OpenworkMemorySuggestionRecord {
  content: string
  createdAt: number
  decision: Record<string, unknown> | null
  reason: string | null
  resolvedAt: number | null
  reviewPayload: Record<string, unknown> | null
  scope: OpenworkMemoryScope
  sourceRunId: string | null
  status: OpenworkMemorySuggestionStatus
  suggestionId: string
  threadId: string | null
  type: OpenworkMemoryType
  updatedAt: number
  workspaceKey: string | null
}

export interface OpenworkMemoryInclusionRecord {
  content: string
  createdAt: number
  inclusionId: string
  memoryId: string
  runId: string
  scope: OpenworkMemoryScope
  threadId: string
  type: OpenworkMemoryType
  workspaceKey: string | null
}

export interface OpenworkMemoryContextItem {
  content: string
  id: string
  kind: OpenworkMemoryContextKind
  scope: OpenworkMemoryScope
  sourceLabel: string
  sourceType: "file" | "structured"
  structuredMemoryId?: string
  truncated?: boolean
}

export interface OpenworkMemoryContextDiagnostic {
  error: string
  id: string
  kind: OpenworkMemoryContextKind
  path?: string
  scope: OpenworkMemoryScope
  sourceLabel: string
}

export interface OpenworkMemoryContextPack {
  canonicalWorkspacePath: string
  diagnostics?: OpenworkMemoryContextDiagnostic[]
  generatedAt: number
  items: OpenworkMemoryContextItem[]
  snapshotTruncated?: boolean
  temporaryMode?: boolean
  workspaceIdentity: OpenworkWorkspaceIdentity
  workspaceKey: string
}

export interface OpenworkMemoryContextSnapshot {
  canonicalWorkspacePath: string
  diagnostics?: OpenworkMemoryContextDiagnostic[]
  generatedAt: number
  items: OpenworkMemoryContextItem[]
  snapshotTruncated?: boolean
  temporaryMode?: boolean
  workspaceIdentity: OpenworkWorkspaceIdentity
  workspaceKey: string
}

export interface OpenworkContextSourceRecord {
  content: string | null
  error: string | null
  exists: boolean
  id: string
  kind: "soul" | "rules" | "instruction_source"
  path: string
  scope: OpenworkMemoryScope
  sourceLabel: string
}

export interface ListOpenworkMemoriesInput {
  query?: string
  scope?: OpenworkMemoryScope
  status?: OpenworkMemoryStatus
  type?: OpenworkMemoryType
}

export interface ListOpenworkSuggestionsInput {
  scope?: OpenworkMemoryScope
  status?: OpenworkMemorySuggestionStatus
  threadId?: string
}

export interface PendingWorkspaceMemoryGuard {
  hasPendingWorkspaceSuggestions: boolean
}

export interface CreateOpenworkMemorySuggestionInput {
  content: string
  reason?: string | null
  reviewPayload?: Record<string, unknown> | null
  scope: OpenworkMemoryScope
  sourceRunId?: string | null
  threadId?: string | null
  type: OpenworkMemoryType
}

export interface CreateOpenworkMemoryInput {
  content: string
  metadata?: Record<string, unknown> | null
  scope: OpenworkMemoryScope
  type: OpenworkMemoryType
}

export interface AcceptOpenworkMemorySuggestionInput {
  content?: string
  scope?: OpenworkMemoryScope
  type?: OpenworkMemoryType
}

export interface UpdateOpenworkMemoryInput {
  content?: string
  scope?: OpenworkMemoryScope
  type?: OpenworkMemoryType
}

// --- AgentContextInclusion (Memory V2) ---

export const AGENT_CONTEXT_SOURCE_TYPES = [
  "memory",
  "context_file",
  "history_message",
  "trace_step",
  "artifact"
] as const

export const AGENT_CONTEXT_INCLUSION_MODES = ["provided", "retrieved", "cited"] as const
export const AGENT_CONTEXT_AVAILABILITIES = ["available", "unavailable"] as const
export const AGENT_CONTEXT_UNAVAILABLE_CODES = [
  "deleted",
  "not_found",
  "permission_denied",
  "snapshot_missing",
  "source_unreadable"
] as const

export type AgentContextSourceType = (typeof AGENT_CONTEXT_SOURCE_TYPES)[number]
export type AgentContextInclusionMode = (typeof AGENT_CONTEXT_INCLUSION_MODES)[number]
export type AgentContextAvailability = (typeof AGENT_CONTEXT_AVAILABILITIES)[number]
export type AgentContextUnavailableCode = (typeof AGENT_CONTEXT_UNAVAILABLE_CODES)[number]

export interface AgentContextJumpTarget {
  artifactId?: string
  memoryId?: string
  messageId?: string
  path?: string
  runId?: string
  threadId?: string
  traceId?: string
  traceStepId?: string
  type: AgentContextSourceType
}

export interface AgentContextUnavailableReason {
  code: AgentContextUnavailableCode
  message: string
}

export interface AgentContextInclusion {
  availability: AgentContextAvailability
  createdAt: number
  id: string
  messageId: string | null
  metadata?: Record<string, unknown>
  mode: AgentContextInclusionMode
  preview: string
  runId: string
  sourceId: string
  sourceType: AgentContextSourceType
  target: AgentContextJumpTarget
  threadId: string
  title: string
  turnId: string | null
  unavailableReason?: AgentContextUnavailableReason
}

export interface CreateRetrievedMemoryContextInclusionInput {
  createdAt: number
  memory: OpenworkMemoryRecord
  runId: string
  threadId: string
}

export interface CreateRetrievedMessageContextInclusionInput {
  createdAt: number
  message: {
    content: string
    id: string
    role: string
    threadId: string
  }
  runId: string
  threadId: string
}

export function contextPackItemToContextInclusion(
  item: OpenworkMemoryContextItem,
  input: { createdAt: number; runId: string; threadId: string }
): AgentContextInclusion {
  const sourceType: AgentContextSourceType =
    item.sourceType === "structured" ? "memory" : "context_file"
  const sourceId = item.structuredMemoryId ?? item.id
  const target: AgentContextJumpTarget =
    sourceType === "memory"
      ? { memoryId: sourceId, type: "memory" }
      : { path: item.id, type: "context_file" }

  return {
    availability: "available",
    createdAt: input.createdAt,
    id: `ctx:${input.runId}:provided:${sourceType}:${sourceId}`,
    messageId: null,
    mode: "provided",
    preview: item.content.slice(0, 200),
    runId: input.runId,
    sourceId,
    sourceType,
    target,
    threadId: input.threadId,
    title: item.sourceLabel,
    turnId: null,
    ...(item.structuredMemoryId
      ? {
          metadata: {
            kind: item.kind,
            scope: item.scope,
            structuredMemoryId: item.structuredMemoryId
          }
        }
      : { metadata: { kind: item.kind, scope: item.scope } })
  }
}

export function buildProvidedContextInclusions(input: {
  contextPack: OpenworkMemoryContextPack
  runId: string
  threadId: string
}): AgentContextInclusion[] {
  const createdAt = input.contextPack.generatedAt
  return input.contextPack.items.map((item) =>
    contextPackItemToContextInclusion(item, {
      createdAt,
      runId: input.runId,
      threadId: input.threadId
    })
  )
}

export function createRetrievedMemoryContextInclusion(
  input: CreateRetrievedMemoryContextInclusionInput
): AgentContextInclusion {
  const { memory } = input

  return {
    availability: "available",
    createdAt: input.createdAt,
    id: `ctx:${input.runId}:retrieved:memory:${memory.memoryId}`,
    messageId: null,
    metadata: {
      scope: memory.scope,
      type: memory.type,
      workspaceKey: memory.workspaceKey
    },
    mode: "retrieved",
    preview: memory.content.slice(0, 200),
    runId: input.runId,
    sourceId: memory.memoryId,
    sourceType: "memory",
    target: {
      memoryId: memory.memoryId,
      type: "memory"
    },
    threadId: input.threadId,
    title: memory.scope === "workspace" ? "Workspace memory" : "Personal memory",
    turnId: null
  }
}

export function createRetrievedMessageContextInclusion(
  input: CreateRetrievedMessageContextInclusionInput
): AgentContextInclusion {
  const sourceId = input.message.id

  return {
    availability: "available",
    createdAt: input.createdAt,
    id: `ctx:${input.runId}:retrieved:history_message:${input.message.threadId}:${sourceId}`,
    messageId: null,
    metadata: {
      role: input.message.role,
      sourceThreadId: input.message.threadId
    },
    mode: "retrieved",
    preview: input.message.content.slice(0, 200),
    runId: input.runId,
    sourceId,
    sourceType: "history_message",
    target: {
      messageId: sourceId,
      threadId: input.message.threadId,
      type: "history_message"
    },
    threadId: input.threadId,
    title: `${input.message.role} message`,
    turnId: null
  }
}

export function upsertAgentContextInclusions(
  existing: AgentContextInclusion[],
  incoming: AgentContextInclusion[]
): AgentContextInclusion[] {
  const inclusions = [...existing]

  for (const inclusion of incoming) {
    const existingIndex = inclusions.findIndex((entry) => entry.id === inclusion.id)
    if (existingIndex >= 0) {
      inclusions[existingIndex] = inclusion
    } else {
      inclusions.push(inclusion)
    }
  }

  return inclusions
}
