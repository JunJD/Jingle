import type { HITLDecision, HITLRequest, Message, Subagent, Todo } from "./app-types"
import type { IpcErrorPayload } from "./ipc-error"

export type AgentThreadRuntimeStatus = "idle" | "running" | "interrupted" | "error" | "cancelled"

export type AgentRunStatus = "running" | "waiting_approval"

export type AgentRunPhase = "thinking" | "streaming" | "tool_running" | "waiting_tool_result"

export type ActiveAgentToolCallStatus = "arguments_streaming" | "running" | "waiting_result"

export const AGENT_TOOL_EXECUTION_METADATA_KEY = "openworkToolExecution"

// Live runtime ownership: active tool calls keep only executable/control facts.
// Tool registry display metadata stays on assistant message tool_calls and is read by renderer projection.
export interface ActiveAgentToolCall {
  argsText: string
  id: string
  index: number | null
  messageId: string | null
  name: string
  runId: string | null
  startedAt: Date
  status: ActiveAgentToolCallStatus
}

export type AgentToolExecutionStatus = "running" | "completed" | "failed"

export interface AgentToolExecutionError {
  message: string
  type?: string
}

export interface AgentToolExecutionTiming {
  completedAt?: Date
  durationMs?: number
  error?: AgentToolExecutionError
  messageId: string | null
  runId: string | null
  startedAt?: Date
  status: AgentToolExecutionStatus
  toolCallId: string
  toolName: string | null
}

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
  currentToolCallId: string | null
  phase: AgentRunPhase | null
  phaseStartedAt: Date
  runId: string | null
  startedAt: Date
  status: AgentRunStatus
  threadId: string
  toolCalls: ActiveAgentToolCall[]
  turnId: string
  userMessageId: string
}

export interface AgentThreadRuntimeState {
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

export type AgentThreadRunFinishStatus = "completed" | "failed" | "cancelled"

export type AgentThreadEvent =
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
      startedAt: Date
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
      messageId: string
      revision: number
      type: "message.truncatedAfter"
    }
  | {
      delta: string
      deltaAt: Date
      field: "text"
      messageId: string
      partId: string
      revision: number
      type: "message.part.delta"
    }
  | {
      revision: number
      toolCall: ActiveAgentToolCall
      type: "tool.callUpdated"
    }
  | {
      messageId: string | null
      revision: number
      runId: string | null
      startedAt: Date
      toolCallId: string
      type: "tool.started"
    }
  | {
      completedAt: Date
      durationMs: number | null
      error: AgentToolExecutionError | null
      messageId: string | null
      revision: number
      runId: string | null
      startedAt: Date | null
      status: "completed" | "failed"
      toolCallId: string
      toolName: string | null
      type: "tool.updated"
    }
  | {
      approval: HITLRequest
      revision: number
      requestedAt: Date
      runId: string | null
      type: "approval.requested"
    }
  | {
      decision: HITLDecision
      revision: number
      resolvedAt: Date
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
      completedAt: Date
      durationMs: number | null
      error: IpcErrorPayload | null
      revision: number
      runId: string | null
      status: AgentThreadRunFinishStatus
      type: "run.finished"
    }

export type AgentThreadEventDraft =
  | Omit<Extract<AgentThreadEvent, { type: "thread.statusChanged" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "run.started" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "run.resumed" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "run.idAssigned" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "run.phaseChanged" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "run.tokenUsageUpdated" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "message.upserted" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "message.truncatedAfter" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "message.part.delta" }>, "revision">
  | Omit<Extract<AgentThreadEvent, { type: "tool.callUpdated" }>, "revision">
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
        { runId: event.runId, toolCalls: updateActiveToolCallRunId(state.activeRun, event.runId) }
      )

    case "run.phaseChanged":
      return updateActiveRun(state, event.revision, {
        phase: event.phase,
        phaseStartedAt: event.startedAt
      })

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

      return updateActiveRunWithPhaseStart(state, event.revision, event.message.created_at, {
        assistantMessageId: event.message.id,
        currentToolCallId: event.message.tool_calls?.at(-1)?.id ?? null,
        phase: (event.message.tool_calls?.length ?? 0) > 0 ? "tool_running" : "streaming",
        toolCalls: mergeMessageToolCalls(state.activeRun, event.message)
      })

    case "message.truncatedAfter":
      return truncateRuntimeMessagesAfter(state, event.messageId, event.revision)

    case "message.part.delta": {
      const nextState = appendRuntimeMessageTextDelta(state, event.messageId, event.delta)
      if (nextState === state) {
        return state
      }

      return updateActiveRunWithPhaseStart(nextState, event.revision, event.deltaAt, {
        assistantMessageId: event.messageId,
        currentToolCallId: null,
        phase: "streaming"
      })
    }

    case "tool.callUpdated":
      return updateActiveRunWithPhaseStart(state, event.revision, event.toolCall.startedAt, {
        ...(event.toolCall.messageId ? { assistantMessageId: event.toolCall.messageId } : {}),
        currentToolCallId: event.toolCall.id,
        phase: "tool_running",
        toolCalls: upsertActiveToolCall(state.activeRun, event.toolCall)
      })

    case "tool.started":
      return updateActiveRunWithPhaseStart(state, event.revision, event.startedAt, {
        ...(event.messageId ? { assistantMessageId: event.messageId } : {}),
        currentToolCallId: event.toolCallId,
        phase: "tool_running",
        toolCalls: updateActiveToolCallStatus(
          state.activeRun,
          event.toolCallId,
          "running",
          event.startedAt
        )
      })

    case "tool.updated": {
      const remainingToolCalls = removeActiveToolCall(state.activeRun, event.toolCallId)
      const currentToolCall = remainingToolCalls.at(-1)
      return updateActiveRunWithPhaseStart(state, event.revision, event.completedAt, {
        currentToolCallId: currentToolCall?.id ?? null,
        phase: currentToolCall ? "tool_running" : "thinking",
        toolCalls: remainingToolCalls
      })
    }

    case "approval.requested":
      return updateActiveRun(
        {
          ...state,
          pendingApproval: event.approval,
          status: "interrupted"
        },
        event.revision,
        {
          currentToolCallId: event.approval.tool_call.id,
          phase: "waiting_tool_result",
          phaseStartedAt: event.requestedAt,
          status: "waiting_approval",
          toolCalls: upsertActiveToolCall(state.activeRun, {
            argsText: JSON.stringify(event.approval.tool_call.args ?? {}),
            id: event.approval.tool_call.id,
            index: null,
            messageId: state.activeRun?.assistantMessageId ?? null,
            name: event.approval.tool_call.name,
            runId: event.runId,
            startedAt:
              state.activeRun?.toolCalls.find(
                (toolCall) => toolCall.id === event.approval.tool_call.id
              )?.startedAt ?? event.requestedAt,
            status: "waiting_result"
          })
        }
      )

    case "approval.cleared":
      if (state.pendingApproval && state.activeRun) {
        const approved = event.decision.type === "approve"
        const toolCallId = state.pendingApproval.tool_call.id
        return updateActiveRun(
          {
            ...state,
            pendingApproval: null
          },
          event.revision,
          {
            currentToolCallId: toolCallId,
            phase: approved ? "tool_running" : "waiting_tool_result",
            phaseStartedAt: event.resolvedAt,
            status: "running",
            toolCalls: upsertActiveToolCall(state.activeRun, {
              argsText: JSON.stringify(state.pendingApproval.tool_call.args ?? {}),
              id: toolCallId,
              index: null,
              messageId: state.activeRun.assistantMessageId,
              name: state.pendingApproval.tool_call.name,
              runId: state.activeRun.runId,
              startedAt: event.resolvedAt,
              status: approved ? "running" : "waiting_result"
            })
          }
        )
      }

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

function truncateRuntimeMessagesAfter(
  state: AgentThreadRuntimeState,
  messageId: string,
  revision: number
): AgentThreadRuntimeState {
  const messageIndex = state.messagesPage.findIndex((message) => message.id === messageId)
  if (messageIndex < 0 || messageIndex === state.messagesPage.length - 1) {
    return updateRevision(state, revision)
  }

  return {
    ...state,
    messagesPage: state.messagesPage.slice(0, messageIndex + 1),
    pendingApproval: null,
    revision,
    subagents: [],
    todos: []
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

function upsertActiveToolCall(
  activeRun: ActiveAgentRun | null,
  toolCall: ActiveAgentToolCall
): ActiveAgentToolCall[] {
  return upsertActiveToolCallInList(activeRun?.toolCalls ?? [], toolCall)
}

function upsertActiveToolCallInList(
  existingToolCalls: ActiveAgentToolCall[],
  toolCall: ActiveAgentToolCall
): ActiveAgentToolCall[] {
  const existingIndex = existingToolCalls.findIndex(
    (entry) =>
      entry.id === toolCall.id ||
      (entry.messageId === toolCall.messageId &&
        entry.index !== null &&
        toolCall.index !== null &&
        entry.index === toolCall.index)
  )
  if (existingIndex < 0) {
    return [...existingToolCalls, toolCall]
  }

  const existingToolCall = existingToolCalls[existingIndex]!
  const nextToolCall: ActiveAgentToolCall = {
    ...existingToolCall,
    ...toolCall,
    argsText: toolCall.argsText || existingToolCall.argsText,
    messageId: toolCall.messageId ?? existingToolCall.messageId,
    name: toolCall.name || existingToolCall.name,
    runId: toolCall.runId ?? existingToolCall.runId,
    startedAt: existingToolCall.startedAt
  }
  const nextToolCalls = [...existingToolCalls]
  nextToolCalls[existingIndex] = nextToolCall
  return nextToolCalls
}

function removeActiveToolCall(
  activeRun: ActiveAgentRun | null,
  toolCallId: string
): ActiveAgentToolCall[] {
  return (activeRun?.toolCalls ?? []).filter((toolCall) => toolCall.id !== toolCallId)
}

function updateActiveToolCallRunId(
  activeRun: ActiveAgentRun | null,
  runId: string
): ActiveAgentToolCall[] {
  return (activeRun?.toolCalls ?? []).map((toolCall) => ({
    ...toolCall,
    runId
  }))
}

function updateActiveToolCallStatus(
  activeRun: ActiveAgentRun | null,
  toolCallId: string,
  status: ActiveAgentToolCallStatus,
  startedAt?: Date
): ActiveAgentToolCall[] {
  return (activeRun?.toolCalls ?? []).map((toolCall) =>
    toolCall.id === toolCallId
      ? { ...toolCall, ...(startedAt ? { startedAt } : {}), status }
      : toolCall
  )
}

function mergeMessageToolCalls(
  activeRun: ActiveAgentRun | null,
  message: Message
): ActiveAgentToolCall[] {
  let toolCalls = activeRun?.toolCalls ?? []

  for (const [index, toolCall] of (message.tool_calls ?? []).entries()) {
    const existingToolCall = toolCalls.find(
      (entry) =>
        entry.id === toolCall.id ||
        (entry.messageId === message.id && entry.index !== null && entry.index === index)
    )
    toolCalls = upsertActiveToolCallInList(toolCalls, {
      argsText: JSON.stringify(toolCall.args ?? {}),
      id: toolCall.id,
      index,
      messageId: message.id,
      name: toolCall.name,
      runId: activeRun?.runId ?? null,
      startedAt: existingToolCall?.startedAt ?? message.created_at ?? new Date(),
      status: "running"
    })
  }

  return toolCalls
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

function updateActiveRunWithPhaseStart(
  state: AgentThreadRuntimeState,
  revision: number,
  phaseStartedAt: Date,
  patch: Partial<ActiveAgentRun>
): AgentThreadRuntimeState {
  if (!state.activeRun) {
    return updateRevision(state, revision)
  }

  const nextPatch =
    patch.phase && patch.phase !== state.activeRun.phase
      ? {
          ...patch,
          phaseStartedAt
        }
      : patch

  return updateActiveRun(state, revision, nextPatch)
}

function updateRevision(state: AgentThreadRuntimeState, revision: number): AgentThreadRuntimeState {
  return {
    ...state,
    revision
  }
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return value
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  return null
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function toToolExecutionStatus(value: unknown): AgentToolExecutionStatus | null {
  return value === "running" || value === "completed" || value === "failed" ? value : null
}

function toToolExecutionError(value: unknown): AgentToolExecutionError | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const message = (value as { message?: unknown }).message
  if (typeof message !== "string" || !message.trim()) {
    return undefined
  }

  const type = (value as { type?: unknown }).type
  return {
    message,
    ...(typeof type === "string" && type.trim() ? { type } : {})
  }
}

export function readAgentToolExecutionTiming(
  message: Pick<Message, "metadata">
): AgentToolExecutionTiming | null {
  const metadataValue = message.metadata?.[AGENT_TOOL_EXECUTION_METADATA_KEY]
  if (!metadataValue || typeof metadataValue !== "object") {
    return null
  }

  const value = metadataValue as Record<string, unknown>
  const toolCallId = typeof value.toolCallId === "string" ? value.toolCallId : null
  const status = toToolExecutionStatus(value.status)
  const startedAt = toDate(value.startedAt)
  if (!toolCallId || !status) {
    return null
  }

  const completedAt = toDate(value.completedAt)
  const durationMs = toFiniteNumber(value.durationMs)
  const messageId = typeof value.messageId === "string" ? value.messageId : null
  const runId = typeof value.runId === "string" ? value.runId : null
  const toolName = typeof value.toolName === "string" ? value.toolName : null
  const error = toToolExecutionError(value.error)

  return {
    ...(completedAt ? { completedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(error ? { error } : {}),
    messageId,
    runId,
    ...(startedAt ? { startedAt } : {}),
    status,
    toolCallId,
    toolName
  }
}
