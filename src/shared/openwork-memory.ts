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
