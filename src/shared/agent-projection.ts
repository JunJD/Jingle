import type { BaseEvent } from "@ag-ui/core"
import type { HITLRequest, Message, Subagent, Todo } from "./app-types"
import type { IpcErrorPayload } from "./ipc-error"

export type AgentProjectionStatus = "idle" | "running" | "interrupted" | "error" | "cancelled"

export interface AgentTokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  lastUpdated: Date
}

export interface AgentThreadProjection {
  error: IpcErrorPayload | null
  isLoading: boolean
  messages: Message[]
  pendingApproval: HITLRequest | null
  runId: string | null
  status: AgentProjectionStatus
  subagents: Subagent[]
  threadId: string
  todos: Todo[]
  tokenUsage: AgentTokenUsage | null
}

export interface AgentProjectionEnvelope {
  event: BaseEvent | null
  projection: AgentThreadProjection
}

export function createDefaultAgentThreadProjection(threadId: string): AgentThreadProjection {
  return {
    error: null,
    isLoading: false,
    messages: [],
    pendingApproval: null,
    runId: null,
    status: "idle",
    subagents: [],
    threadId,
    todos: [],
    tokenUsage: null
  }
}
