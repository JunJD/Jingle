import type { ToolCall as LangChainToolCall } from "@langchain/core/messages"
import type { AgentInvokeMessage } from "@shared/message-content"
import type { AppLocale } from "@shared/i18n"
import type { HITLDecision, HITLRequest } from "@shared/hitl"
import type { PermissionModeName } from "@shared/permission-mode"
import type { AgentFollowUpAction, AgentFollowUpMode } from "@shared/agent-follow-up"
import type { ArtifactRecord } from "@shared/artifacts"
import type { CustomProviderInput, ProviderId, SetDefaultModelOptions } from "@shared/app-types"
import type { AgentContextInclusion } from "@shared/openwork-memory"
import type { ExtensionToolCallPresentation, ToolCallDisplay } from "@shared/tool-presentation"
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
  ThinkingEffort
} from "@shared/app-types"

// Thread types matching langgraph-api
export type ThreadStatus = "idle" | "busy" | "interrupted" | "error"

// =============================================================================
// IPC Handler Parameter Types
// =============================================================================

// Agent IPC
export interface AgentInvokeParams {
  threadId: string
  message: AgentInvokeMessage
  modelId?: string
  permissionMode?: PermissionModeName
  temporaryMode?: boolean
  followUpAction?: AgentFollowUpAction
}

export interface AgentEditLastUserMessageAndInvokeParams extends AgentInvokeParams {}

export interface AgentResumeParams {
  threadId: string
  command: {
    resume?: HITLDecision
  }
  modelId?: string
}

export interface AgentCancelParams {
  threadId: string
}

export interface AgentConnectThreadEventsParams {
  fromRevision?: number
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

// Subagent types (from deepagentsjs)
export interface Subagent {
  id: string
  name: string
  description: string
  status: "pending" | "running" | "completed" | "failed"
  startedAt?: Date
  completedAt?: Date
}

// Stream events from agent
export type StreamEvent =
  | { type: "message"; message: Message }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "tool_result"; toolResult: ToolResult }
  | { type: "interrupt"; request: HITLRequest }
  | { type: "token"; token: string }
  | { type: "todos"; todos: Todo[] }
  | { type: "subagents"; subagents: Subagent[] }
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

export interface ToolCall extends LangChainToolCall<string, Record<string, unknown>> {
  display?: ToolCallDisplay
  id: string
  presentation?: ExtensionToolCallPresentation
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

// Todo types (from deepagentsjs)
export interface Todo {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
}

// File types (from deepagentsjs backends)
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
