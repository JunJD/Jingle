export type JingleRuntimeStatus = "cancelled" | "error" | "idle" | "interrupted" | "running"

export type JingleRunStatus = "running" | "waiting_approval"

export type JingleRunFinishStatus = "cancelled" | "completed" | "failed"

export type JingleRunPhase = "thinking" | "streaming" | "tool_running" | "waiting_tool_result"

export type JingleToolActivityStatus =
  | "arguments_streaming"
  | "completed"
  | "failed"
  | "running"
  | "waiting_result"

export type JingleActiveToolCallStatus = Extract<
  JingleToolActivityStatus,
  "arguments_streaming" | "running" | "waiting_result"
>

export type JingleTodoStatus = "cancelled" | "completed" | "in_progress" | "pending"

export interface JingleTodo {
  content: string
  id: string
  status: JingleTodoStatus
}

export interface JingleTokenUsage {
  cacheCreationTokens?: number
  cacheReadTokens?: number
  inputTokens: number
  lastUpdated: string
  outputTokens: number
  totalTokens: number
}
