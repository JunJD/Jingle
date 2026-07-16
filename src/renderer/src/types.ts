import type { AppLocale } from "@shared/i18n"
import type { HITLRequest } from "@shared/hitl"
import type { Message, Todo as SharedTodo, ToolCall, ToolResult } from "@shared/app-types"
export type { HITLDecision, HITLRequest } from "@shared/hitl"
export type {
  ModelConfig,
  ModelProviderState,
  ModelType,
  ContentBlock,
  Message,
  MessageContent,
  Provider,
  ProviderId,
  ToolCall,
  ToolResult
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
