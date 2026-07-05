import type { AppLocale } from "@shared/i18n"
import type { HITLRequest } from "@shared/hitl"
import type { Todo as SharedTodo, ToolCall } from "@shared/app-types"
export type { HITLDecision, HITLRequest } from "@shared/hitl"
export type {
  ModelConfig,
  ModelProviderState,
  ModelType,
  Provider,
  ProviderId,
  ToolCall
} from "@shared/app-types"

// Re-export types from electron for use in renderer
export type ThreadStatus = "idle" | "busy" | "interrupted" | "error"

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
  skillSources: string[]
  locale: AppLocale
}

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
  // For tool messages - links result to its tool call
  tool_call_id?: string
  // For tool messages - the name of the tool
  name?: string
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

export type ThreadForkBlockReason = "busy" | "checkpoint_interrupt" | "pending_hitl"

export interface ThreadForkState {
  canFork: boolean
  reason?: ThreadForkBlockReason
}

export type Todo = SharedTodo

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
