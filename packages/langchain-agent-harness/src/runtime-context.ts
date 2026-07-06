import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type { RuntimeRunContextScope, RuntimeThreadScope } from "./runtime-scope"

export type RuntimeContextSurface =
  | "context-retrieval"
  | "memory"
  | "memory-recording-refs"
  | "workspace-file-context"

export type RuntimeContextNeighborSurface =
  | "guardrail"
  | "system-prompt"
  | "title-generation"

export type RuntimeContextMiddlewareExitPriority =
  | "early"
  | "not-context-owned"

export interface RuntimeContextSurfaceContract {
  currentImplementation: "middleware-compiled" | "owned-by-neighbor-lane"
  exitPriority: RuntimeContextMiddlewareExitPriority
  owner: "RuntimeContext" | "RuntimePrompt" | "RuntimeExecutionPolicy"
  surface: RuntimeContextSurface | RuntimeContextNeighborSurface
}

export const RUNTIME_CONTEXT_SURFACE_CONTRACTS = {
  contextRetrieval: {
    currentImplementation: "middleware-compiled",
    exitPriority: "early",
    owner: "RuntimeContext",
    surface: "context-retrieval"
  },
  memory: {
    currentImplementation: "middleware-compiled",
    exitPriority: "early",
    owner: "RuntimeContext",
    surface: "memory"
  },
  memoryRecordingRefs: {
    currentImplementation: "middleware-compiled",
    exitPriority: "early",
    owner: "RuntimeContext",
    surface: "memory-recording-refs"
  },
  workspaceFileContext: {
    currentImplementation: "middleware-compiled",
    exitPriority: "early",
    owner: "RuntimeContext",
    surface: "workspace-file-context"
  },
  guardrail: {
    currentImplementation: "owned-by-neighbor-lane",
    exitPriority: "not-context-owned",
    owner: "RuntimeExecutionPolicy",
    surface: "guardrail"
  },
  systemPrompt: {
    currentImplementation: "owned-by-neighbor-lane",
    exitPriority: "not-context-owned",
    owner: "RuntimePrompt",
    surface: "system-prompt"
  },
  titleGeneration: {
    currentImplementation: "owned-by-neighbor-lane",
    exitPriority: "not-context-owned",
    owner: "RuntimePrompt",
    surface: "title-generation"
  }
} as const satisfies Record<string, RuntimeContextSurfaceContract>

export interface RuntimeWorkspaceFileContextRequest {
  messageRefs: unknown
  messageText: string
}

export interface RuntimeWorkspaceFileContextConfig {
  resolveContext: (request: RuntimeWorkspaceFileContextRequest) => Promise<string | null>
}

export interface RuntimeGetMessageContextInput {
  after?: number
  before?: number
  messageId: string
  threadId: string
}

export interface RuntimeSearchHistoryInput {
  limit?: number
  query: string
  threadId?: string
}

export interface RuntimeGetTraceEvidenceInput {
  artifactId?: string
  includeInput?: boolean
  includeOutput?: boolean
  runId?: string
  toolCallId?: string
  traceId?: string
  traceStepId?: string
}

export interface RuntimeContextRetrievalToolContext<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> {
  existingContextInclusions: TContextInclusion[]
  runId: string
  toolCallId: string
}

export interface RuntimeContextRetrievalResult<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> {
  content: string
  contextInclusions?: TContextInclusion[]
}

export interface RuntimeContextRetrievalConfig<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> {
  getMessageContext: (
    input: RuntimeGetMessageContextInput,
    context: RuntimeContextRetrievalToolContext<TContextInclusion>
  ) => Promise<RuntimeContextRetrievalResult<TContextInclusion>>
  getTraceEvidence: (
    input: RuntimeGetTraceEvidenceInput,
    context: RuntimeContextRetrievalToolContext<TContextInclusion>
  ) => Promise<RuntimeContextRetrievalResult<TContextInclusion>>
  searchHistory: (
    input: RuntimeSearchHistoryInput,
    context: RuntimeContextRetrievalToolContext<TContextInclusion>
  ) => Promise<RuntimeContextRetrievalResult<TContextInclusion>>
}

export interface RuntimeSuggestPersonalMemoryInput {
  content: string
  reason?: string
  scope: "global" | "workspace"
  type: "about_me" | "workspace_context" | "correction"
}

export interface RuntimeSuggestPersonalMemoryContext<TContextInclusion = unknown> {
  contextInclusions: TContextInclusion[]
  runId: string
}

export interface RuntimeMemoryConfig<TContextInclusion = unknown> {
  applyMemoryContextToSystemPrompt?: (systemPrompt: string) => string | Promise<string>
  enableSuggestionTool: boolean
  suggestPersonalMemory: (
    input: RuntimeSuggestPersonalMemoryInput,
    context: RuntimeSuggestPersonalMemoryContext<TContextInclusion>
  ) => Promise<string>
}

export type RuntimeWorkspaceFileContextProviderContract = (
  thread: RuntimeThreadScope
) => RuntimeWorkspaceFileContextConfig | null | undefined

export type RuntimeContextRetrievalProviderContract<
  TContextInclusion extends JingleContextInclusionStateItem = JingleContextInclusionStateItem
> = (
  run: RuntimeRunContextScope
) => RuntimeContextRetrievalConfig<TContextInclusion>

export type RuntimeMemoryProviderContract<TContextInclusion = unknown> = (
  run: RuntimeRunContextScope
) => RuntimeMemoryConfig<TContextInclusion>
