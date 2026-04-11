import type { ToolCall as LangChainToolCall } from "@langchain/core/messages"
import type { AgentInvokeMessage } from "../shared/message-content"
import type { AppLocale } from "../shared/i18n"
import type { HITLDecision, HITLRequest } from "../shared/hitl"
export type { HITLDecision, HITLRequest } from "../shared/hitl"

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
}

export interface AgentResumeParams {
  threadId: string
  command: {
    resume?: HITLDecision
  }
  modelId?: string
}

export interface AgentInterruptParams {
  threadId: string
  decision: HITLDecision
}

export interface AgentCancelParams {
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

export interface WorkspaceFileParams {
  threadId: string
  filePath: string
}

// Model IPC
export interface SetApiKeyParams {
  provider: string
  apiKey: string
}

// =============================================================================

export interface Thread {
  thread_id: string
  created_at: Date
  updated_at: Date
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

// Provider configuration
export type ProviderId = "anthropic" | "openai" | "google" | "dashscope" | "ollama"

export interface Provider {
  id: ProviderId
  name: string
  hasApiKey: boolean
}

// Model configuration
export interface ModelConfig {
  id: string
  name: string
  provider: ProviderId
  model: string
  description?: string
  available: boolean
}

export interface AgentConfig {
  skillSources: string[]
  memorySources: string[]
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
  type: "text" | "image" | "image_url" | "file" | "tool_use" | "tool_result"
  text?: string
  tool_use_id?: string
  name?: string
  input?: unknown
  content?: string
  image_url?: string | { detail?: "auto" | "high" | "low"; url: string }
  mimeType?: string
}

export interface ToolCall extends LangChainToolCall<string, Record<string, unknown>> {
  id: string
}

export interface ToolResult {
  tool_call_id: string
  content: string | unknown
}

export interface ThreadRuntimeState {
  todos: Todo[]
  pendingApproval: HITLRequest | null
}

export interface ThreadHistoryState extends ThreadRuntimeState {
  messages: Message[]
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
