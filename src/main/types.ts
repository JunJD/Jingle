import type { AgentInvokeMessage, ComposerMessageInput } from "@shared/message-content"
import type { AppLocale } from "@shared/i18n"
import type { HITLRequest } from "@shared/hitl"
import type { PermissionModeName } from "@shared/permission-mode"
import type { AgentFollowUpMode } from "@shared/agent-follow-up"
import type { ArtifactRecord } from "@shared/artifacts"
import type { JingleTodo } from "@jingle/agent-client"
import type {
  AgentThreadEventSubscriptionSurface,
  AgentThreadEventSubscriptionToken
} from "@shared/agent-thread-contract"
import type {
  CustomProviderInput,
  ProviderId,
  SetDefaultModelOptions,
  ToolCall
} from "@shared/app-types"
import type {
  JingleAgentFollowUpAction,
  JingleAgentFollowUpQueueItem,
  JingleAgentResumeDecision
} from "@jingle/agent-client"
import type { AgentContextInclusion } from "@shared/jingle-memory"
export type { HITLDecision, HITLRequest } from "@shared/hitl"
export type {
  CreateThreadInput,
  CustomProviderConfig,
  CustomProviderInput,
  DefaultModelOptions,
  ModelProviderPaths,
  ModelConfig,
  ModelProviderState,
  ModelType,
  Provider,
  ProviderModelsResponse,
  ProviderId,
  SetDefaultModelOptions,
  ThinkingEffort,
  ToolCall
} from "@shared/app-types"

// Thread types matching langgraph-api
export type ThreadStatus = "idle" | "busy" | "interrupted" | "error"

// =============================================================================
// IPC Handler Parameter Types
// =============================================================================

// Agent IPC
export interface AgentInvokeParams {
  expectedRunId?: string | null
  expectedTurnId?: string | null
  followUpAction?: JingleAgentFollowUpAction
  threadId: string
  message: AgentInvokeMessage
  modelId?: string
  permissionMode?: PermissionModeName
  temporaryMode?: boolean
}

export interface AgentEditLastUserMessageAndInvokeParams extends AgentInvokeParams {}

export interface AgentResumeParams {
  threadId: string
  decision: JingleAgentResumeDecision
  modelId?: string
}

export interface AgentCancelParams {
  threadId: string
}

export interface AgentConnectThreadEventsParams {
  fromRevision?: number
  surface?: AgentThreadEventSubscriptionSurface
  threadId: string
}

export interface AgentDisconnectThreadEventsParams {
  subscriptionToken: AgentThreadEventSubscriptionToken
  threadId: string
}

export interface AgentFollowUpQueueItemParams {
  item: JingleAgentFollowUpQueueItem
  threadId: string
}

export interface AgentFollowUpQueueRequestParams {
  expectedRunId?: string | null
  expectedTurnId?: string | null
  requestId: string
  threadId: string
}

export interface AgentFollowUpQueueMessageParams {
  messageInput: ComposerMessageInput
  threadId: string
}

// Thread IPC
export interface ThreadUpdateParams {
  threadId: string
  updates: Partial<Thread>
}

// Workspace IPC
export interface WorkspaceSetParams {
  threadId?: string
  path: string | null
}

export interface WorkspaceCreateDefaultParams {
  title?: string
}

export interface WorkspaceFileParams {
  threadId: string
  filePath: string
}

export interface WorkspaceFileSearchParams {
  limit?: number
  query: string
  threadId?: string
}

// Model IPC
export interface SetProviderCredentialsParams {
  credentials: Record<string, string>
  provider: ProviderId
}

export interface SetDefaultModelParams {
  modelId: string
  modelType: "llm"
  options?: SetDefaultModelOptions
}

export interface UpsertCustomProviderParams {
  provider: CustomProviderInput
}

// =============================================================================

export interface Thread {
  thread_id: string
  created_at: Date
  updated_at: Date
  archived_at?: Date | null
  metadata?: Record<string, unknown>
  status: ThreadStatus
  thread_values?: Record<string, unknown>
  title?: string
}

// Run types
export type RunStatus = "pending" | "running" | "error" | "success" | "interrupted"

export interface Run {
  run_id: string
  thread_id: string
  assistant_id?: string
  created_at: Date
  updated_at: Date
  status: RunStatus
  metadata?: Record<string, unknown>
}

export interface AgentConfig {
  desktopAutomationAllowlist: string[]
  followUpMode: AgentFollowUpMode
  skillSources: string[]
  locale: AppLocale
}

// Stream events from agent
export type StreamEvent =
  | { type: "message"; message: Message }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "tool_result"; toolResult: ToolResult }
  | { type: "interrupt"; request: HITLRequest }
  | { type: "token"; token: string }
  | { type: "todos"; todos: Todo[] }
  | { type: "done"; result: unknown }
  | { type: "error"; error: string }

export interface Message {
  id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string | ContentBlock[]
  tool_calls?: ToolCall[]
  metadata?: Record<string, unknown>
  created_at: Date
}

export interface ContentBlock {
  type: "text" | "reasoning" | "image" | "image_url" | "file" | "tool_use" | "tool_result"
  text?: string
  reasoning?: string
  signature?: string
  tool_use_id?: string
  name?: string
  input?: unknown
  content?: string
  image_url?: string | { detail?: "auto" | "high" | "low"; url: string }
  mimeType?: string
}

export interface ToolResult {
  tool_call_id: string
  content: string | unknown
}

export interface AgentThreadMessagesSnapshot {
  artifacts: ArtifactRecord[]
  messages: Message[]
}

export interface AgentThreadInfoSnapshot {
  metadata?: Record<string, unknown>
  status: ThreadStatus
  thread_id: string
  title?: string
}

export interface AgentThreadRunStateSnapshot {
  contextInclusions: AgentContextInclusion[]
  error: string | null
  forkState: ThreadForkState
  pendingApproval: HITLRequest | null
  runId: string | null
  todos: Todo[]
  workspacePath: string | null
}

export interface AgentThreadDataSnapshot {
  thread: AgentThreadInfoSnapshot
  messages: AgentThreadMessagesSnapshot
  runState: AgentThreadRunStateSnapshot
}

export type ThreadForkBlockReason = "busy" | "checkpoint_interrupt" | "pending_hitl"

export interface ThreadForkState {
  canFork: boolean
  reason?: ThreadForkBlockReason
}

export type Todo = JingleTodo

// File types from the local harness filesystem backend.
export interface FileInfo {
  path: string
  is_dir?: boolean
  size?: number
  modified_at?: string
}

export interface GrepMatch {
  path: string
  line: number
  text: string
}
