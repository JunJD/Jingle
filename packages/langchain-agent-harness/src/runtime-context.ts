import type { JingleContextInclusionStateItem } from "./context-inclusion-state"
import type { RuntimeRunContextScope, RuntimeThreadScope } from "./runtime-scope"

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
> = (run: RuntimeRunContextScope) => RuntimeContextRetrievalConfig<TContextInclusion>

export type RuntimeMemoryProviderContract<TContextInclusion = unknown> = (
  run: RuntimeRunContextScope
) => RuntimeMemoryConfig<TContextInclusion>
