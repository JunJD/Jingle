import type { ToolCall as LangChainToolCall } from "@langchain/core/messages"
import type { AppLocale } from "./i18n"
import type { HITLRequest } from "./hitl"
import type { ArtifactRecord } from "./artifacts"
export type { HITLDecision, HITLRequest } from "./hitl"

export type ThreadStatus = "idle" | "busy" | "interrupted" | "error"

export interface Thread {
  thread_id: string
  created_at: Date
  updated_at: Date
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

export type ProviderId = "anthropic" | "openai" | "google" | "dashscope"

export type ProviderModelStatus = "available" | "error" | "not_configured"

export interface Provider {
  id: ProviderId
  name: string
  hasApiKey: boolean
  modelError?: string
  modelStatus: ProviderModelStatus
}

export interface ModelConfig {
  id: string
  name: string
  provider: ProviderId
  model: string
  description?: string
  available: boolean
}

export interface ModelProviderState {
  models: ModelConfig[]
  providers: Provider[]
}

export interface AgentConfig {
  skillSources: string[]
  memorySources: string[]
  locale: AppLocale
}

export interface Subagent {
  id: string
  name: string
  description: string
  status: "pending" | "running" | "completed" | "failed"
  startedAt?: Date
  completedAt?: Date
  toolCallId?: string
  subagentType?: string
}

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
  tool_call_id?: string
  name?: string
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
  artifacts: ArtifactRecord[]
  messages: Message[]
}

export interface Todo {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
}

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
