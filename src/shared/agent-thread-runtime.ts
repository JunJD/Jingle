import type { HITLRequest, Message, Subagent, Todo } from "./app-types"
import type { IpcErrorPayload } from "./ipc-error"

export type AgentThreadRuntimeStatus =
  | "idle"
  | "running"
  | "interrupted"
  | "error"
  | "cancelled"

export type AgentRunStatus = "running" | "waiting_approval"

export type AgentRunPhase = "thinking" | "streaming" | "tool_running" | "waiting_tool_result"

export interface AgentTokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  lastUpdated: Date
}

export interface ActiveAgentRun {
  assistantMessageId: string | null
  phase: AgentRunPhase | null
  runId: string | null
  status: AgentRunStatus
  threadId: string
  turnId: string
  userMessageId: string
}

export interface AgentThreadSnapshot {
  activeRun: ActiveAgentRun | null
  error: IpcErrorPayload | null
  hasMoreBefore: boolean
  latestRunId: string | null
  messagesPage: Message[]
  pendingApproval: HITLRequest | null
  revision: number
  status: AgentThreadRuntimeStatus
  subagents: Subagent[]
  threadId: string
  todos: Todo[]
  tokenUsage: AgentTokenUsage | null
}

export interface AgentThreadEventBatch {
  events: AgentThreadEvent[]
  latestRevision: number
  threadId: string
}

export interface AgentThreadRuntimeState extends AgentThreadSnapshot {}

export type AgentThreadRunFinishStatus = "completed" | "failed" | "cancelled"

export type AgentThreadEvent =
  | {
      revision: number
      snapshot: AgentThreadSnapshot
      type: "thread.snapshot"
    }
  | {
      error: IpcErrorPayload | null
      revision: number
      status: AgentThreadRuntimeStatus
      type: "thread.statusChanged"
    }
  | {
      revision: number
      run: ActiveAgentRun
      type: "run.started"
    }
  | {
      revision: number
      run: ActiveAgentRun
      type: "run.resumed"
    }
  | {
      revision: number
      runId: string
      type: "run.idAssigned"
    }
  | {
      phase: AgentRunPhase
      revision: number
      runId: string | null
      type: "run.phaseChanged"
    }
  | {
      revision: number
      tokenUsage: AgentTokenUsage | null
      type: "run.tokenUsageUpdated"
    }
  | {
      message: Message
      revision: number
      type: "message.upserted"
    }
  | {
      messages: Message[]
      revision: number
      type: "messages.replaced"
    }
  | {
      delta: string
      field: "text"
      messageId: string
      partId: string
      revision: number
      type: "message.part.delta"
    }
  | {
      messageId: string | null
      revision: number
      runId: string | null
      toolCallId: string
      type: "tool.started"
    }
  | {
      messageId: string | null
      revision: number
      runId: string | null
      toolCallId: string
      type: "tool.updated"
    }
  | {
      approval: HITLRequest
      revision: number
      runId: string | null
      type: "approval.requested"
    }
  | {
      revision: number
      type: "approval.cleared"
    }
  | {
      revision: number
      subagents: Subagent[]
      type: "subagents.replaced"
    }
  | {
      revision: number
      todos: Todo[]
      type: "todos.replaced"
    }
  | {
      revision: number
      runId: string | null
      status: AgentThreadRunFinishStatus
      type: "run.finished"
    }

export type AgentThreadEventDraft =
  | {
      snapshot: Omit<AgentThreadSnapshot, "revision">
      type: "thread.snapshot"
    }
  | Omit<Extract<AgentThreadEvent, { type: "thread.statusChanged" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "run.started" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "run.resumed" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "run.idAssigned" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "run.phaseChanged" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "run.tokenUsageUpdated" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "message.upserted" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "messages.replaced" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "message.part.delta" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "tool.started" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "tool.updated" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "approval.requested" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "approval.cleared" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "subagents.replaced" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "todos.replaced" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "run.finished" }>, "revision">

export function createDefaultAgentThreadRuntimeState(threadId: string): AgentThreadRuntimeState {
  return {
    activeRun: null,
    error: null,
    hasMoreBefore: false,
    latestRunId: null,
    messagesPage: [],
    pendingApproval: null,
    revision: 0,
    status: "idle",
    subagents: [],
    threadId,
    todos: [],
    tokenUsage: null
  }
}

export function reduceAgentThreadRuntimeEvent(
  state: AgentThreadRuntimeState,
  event: AgentThreadEvent
): AgentThreadRuntimeState {
  if (event.revision <= state.revision) {
    return state
  }

  switch (event.type) {
    case "thread.snapshot":
      return event.snapshot.revision > state.revision ? event.snapshot : state

    case "thread.statusChanged":
      return {
        ...state,
        error: event.error,
        revision: event.revision,
        status: event.status
      }

    case "run.started":
      return {
        ...state,
        activeRun: event.run,
        error: null,
        latestRunId: event.run.runId,
        pendingApproval: null,
        revision: event.revision,
        status: "running",
        subagents: [],
        threadId: event.run.threadId,
        tokenUsage: null
      }

    case "run.resumed":
      return {
        ...state,
        activeRun: event.run,
        error: null,
        latestRunId: event.run.runId,
        revision: event.revision,
        status: "running",
        subagents: [],
        threadId: event.run.threadId,
        tokenUsage: null
      }

    case "run.idAssigned":
      return updateActiveRun(
        {
          ...state,
          latestRunId: event.runId
        },
        event.revision,
        { runId: event.runId }
      )

    case "run.phaseChanged":
      return updateActiveRun(state, event.revision, { phase: event.phase })

    case "run.tokenUsageUpdated":
      return {
        ...state,
        revision: event.revision,
        tokenUsage: event.tokenUsage
      }

    case "message.upserted":
      state = upsertRuntimeMessage(state, event.message)
      if (event.message.role !== "assistant") {
        return updateRevision(state, event.revision)
      }

      return updateActiveRun(state, event.revision, {
        assistantMessageId: event.message.id,
        phase: (event.message.tool_calls?.length ?? 0) > 0 ? "tool_running" : "streaming"
      })

    case "messages.replaced":
      return {
        ...state,
        messagesPage: event.messages,
        revision: event.revision
      }

    case "message.part.delta":
      {
        const nextState = appendRuntimeMessageTextDelta(state, event.messageId, event.delta)
        if (nextState === state) {
          return state
        }

        return updateActiveRun(nextState, event.revision, {
          assistantMessageId: event.messageId,
          phase: "streaming"
        })
      }

    case "tool.started":
      return updateActiveRun(state, event.revision, {
        ...(event.messageId ? { assistantMessageId: event.messageId } : {}),
        phase: "tool_running"
      })

    case "tool.updated":
      return updateActiveRun(state, event.revision, {
        ...(event.messageId ? { assistantMessageId: event.messageId } : {}),
        phase: "waiting_tool_result"
      })

    case "approval.requested":
      return updateActiveRun(
        {
          ...state,
          pendingApproval: event.approval,
          status: "interrupted"
        },
        event.revision,
        {
          phase: "waiting_tool_result",
          status: "waiting_approval"
        }
      )

    case "approval.cleared":
      return {
        ...state,
        pendingApproval: null,
        revision: event.revision
      }

    case "subagents.replaced":
      return {
        ...state,
        revision: event.revision,
        subagents: event.subagents
      }

    case "todos.replaced":
      return {
        ...state,
        revision: event.revision,
        todos: event.todos
      }

    case "run.finished":
      return {
        ...state,
        activeRun: null,
        pendingApproval: event.status === "cancelled" ? null : state.pendingApproval,
        revision: event.revision,
        status:
          event.status === "failed"
            ? "error"
            : event.status === "cancelled"
              ? "cancelled"
              : state.pendingApproval
                ? "interrupted"
                : "idle"
      }
  }
}

function appendRuntimeMessageTextDelta(
  state: AgentThreadRuntimeState,
  messageId: string,
  delta: string
): AgentThreadRuntimeState {
  if (delta.length === 0) {
    return state
  }

  const existingIndex = state.messagesPage.findIndex((message) => message.id === messageId)
  if (existingIndex < 0) {
    return state
  }

  const existingMessage = state.messagesPage[existingIndex]
  if (existingMessage?.role !== "assistant" || typeof existingMessage.content !== "string") {
    return state
  }

  const messagesPage = [...state.messagesPage]
  messagesPage[existingIndex] = {
    ...existingMessage,
    content: `${existingMessage.content}${delta}`
  }
  return {
    ...state,
    messagesPage
  }
}

function upsertRuntimeMessage(
  state: AgentThreadRuntimeState,
  message: Message
): AgentThreadRuntimeState {
  const existingIndex = state.messagesPage.findIndex((entry) => entry.id === message.id)
  if (existingIndex < 0) {
    return {
      ...state,
      messagesPage: [...state.messagesPage, message]
    }
  }

  const messagesPage = [...state.messagesPage]
  messagesPage[existingIndex] = message
  return {
    ...state,
    messagesPage
  }
}

function updateActiveRun(
  state: AgentThreadRuntimeState,
  revision: number,
  patch: Partial<ActiveAgentRun>
): AgentThreadRuntimeState {
  if (!state.activeRun) {
    return updateRevision(state, revision)
  }

  return {
    ...state,
    activeRun: {
      ...state.activeRun,
      ...patch
    },
    revision
  }
}

function updateRevision(state: AgentThreadRuntimeState, revision: number): AgentThreadRuntimeState {
  return {
    ...state,
    revision
  }
}
