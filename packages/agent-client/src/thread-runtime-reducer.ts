import type { JingleRuntimeStatus, JingleTokenUsage } from "./profile"
import {
  patchJingleActiveAgentRun,
  patchJingleActiveAgentRunWithPhaseStart,
  removeJingleActiveAgentToolCall,
  updateJingleActiveAgentToolCallRunId,
  updateJingleActiveAgentToolCallStatus,
  upsertJingleActiveAgentToolCall,
  upsertJingleActiveAgentToolCallInList,
  type JingleActiveAgentRun,
  type JingleActiveAgentToolCall
} from "./live-state"
import type { JingleAgentFollowUpQueueSummary } from "./commands"
import type { JingleAgentThreadEvent } from "./thread-runtime-event"
import type { JingleAgentThreadRuntimeState } from "./thread-runtime-state"

interface JingleRuntimeMessageToolCall {
  args?: unknown
  id: string
  name: string
}

interface JingleRuntimeMessage {
  content: string | unknown
  created_at: Date
  id: string
  role: "assistant" | "system" | "tool" | "user" | string
  tool_calls?: JingleRuntimeMessageToolCall[]
  metadata?: Record<string, unknown>
  tool_call_id?: string
  name?: string
}

interface JingleRuntimeContextInclusion {
  availability?: "available" | "unavailable" | string
  id: string
  messageId: string | null
  mode: "provided" | string
  turnId: string | null
  unavailableReason?: {
    code: "deleted" | string
    message: string
  } | null
}

interface JingleRuntimePendingApproval {
  tool_call: {
    args?: Record<string, unknown> | undefined
    id: string
    name: string
  }
}

interface JingleRuntimeHitlDecision {
  type: "approve" | "reject" | string
}

type Message = JingleRuntimeMessage
type AgentContextInclusion = JingleRuntimeContextInclusion
type HITLRequest = JingleRuntimePendingApproval
type HITLDecision = JingleRuntimeHitlDecision
type Todo = unknown
type IpcErrorPayload = {
  channel?: string
  code: string
  details?: unknown
  message: string
  status: number
}

type AgentThreadRuntimeState = JingleAgentThreadRuntimeState<
  AgentContextInclusion,
  IpcErrorPayload,
  JingleAgentFollowUpQueueSummary,
  Message,
  HITLRequest,
  JingleActiveAgentRun,
  Todo,
  JingleTokenUsage,
  JingleRuntimeStatus
>

type AgentThreadEvent = JingleAgentThreadEvent<
  AgentContextInclusion,
  IpcErrorPayload,
  JingleAgentFollowUpQueueSummary,
  Message,
  HITLRequest,
  JingleActiveAgentRun,
  Todo,
  JingleTokenUsage,
  JingleRuntimeStatus,
  HITLDecision
>

export function reduceJingleAgentThreadRuntimeEvent<
  TState extends AgentThreadRuntimeState,
  TEvent extends AgentThreadEvent
>(state: TState, event: TEvent): TState {
  return reduceJingleAgentThreadRuntimeEventInternal(state, event) as TState
}

function reduceJingleAgentThreadRuntimeEventInternal(
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
        contextInclusions: retainHistoricalContextInclusions(state.contextInclusions),
        error: null,
        latestRunId: event.run.runId,
        pendingApproval: null,
        revision: event.revision,
        status: "running",
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
        {
          runId: event.runId,
          toolCalls: updateJingleActiveAgentToolCallRunId(state.activeRun, event.runId)
        }
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

    case "steer.applied":
      return updateActiveRun(state, event.revision, {
        turnId: event.messageId,
        userMessageId: event.messageId
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
        toolCalls: upsertJingleActiveAgentToolCall(state.activeRun, event.toolCall)
      })

    case "tool.started":
      return updateActiveRunWithPhaseStart(state, event.revision, event.startedAt, {
        ...(event.messageId ? { assistantMessageId: event.messageId } : {}),
        currentToolCallId: event.toolCallId,
        phase: "tool_running",
        toolCalls: updateJingleActiveAgentToolCallStatus(
          state.activeRun,
          event.toolCallId,
          "running",
          event.startedAt
        )
      })

    case "tool.updated": {
      const remainingToolCalls = removeJingleActiveAgentToolCall(state.activeRun, event.toolCallId)
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
          toolCalls: upsertJingleActiveAgentToolCall(state.activeRun, {
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
            toolCalls: upsertJingleActiveAgentToolCall(state.activeRun, {
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

    case "todos.replaced":
      return {
        ...state,
        revision: event.revision,
        todos: event.todos
      }

    case "context.inclusionsReplaced":
      return {
        ...state,
        contextInclusions: replaceRuntimeContextInclusions({
          activeRun: state.activeRun,
          existing: state.contextInclusions,
          incoming: event.inclusions
        }),
        revision: event.revision
      }

    case "followUp.queueChanged":
      return {
        ...state,
        followUpQueue: event.summary,
        revision: event.revision
      }

    case "run.finished":
      return {
        ...state,
        activeRun: null,
        pendingApproval: state.pendingApproval,
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
    contextInclusions: markTruncatedContextInclusionsUnavailable({
      anchorMessage: state.messagesPage[messageIndex] ?? null,
      inclusions: state.contextInclusions,
      removedMessageIds: new Set(
        state.messagesPage.slice(messageIndex + 1).map((message) => message.id)
      )
    }),
    messagesPage: state.messagesPage.slice(0, messageIndex + 1),
    pendingApproval: null,
    revision,
    todos: []
  }
}

function retainHistoricalContextInclusions(
  inclusions: AgentContextInclusion[]
): AgentContextInclusion[] {
  return inclusions.filter(
    (inclusion) =>
      inclusion.mode !== "provided" && (inclusion.turnId !== null || inclusion.messageId !== null)
  )
}

function bindRuntimeContextInclusionsToActiveTurn(
  inclusions: AgentContextInclusion[],
  activeRun: JingleActiveAgentRun | null
): AgentContextInclusion[] {
  if (!activeRun) {
    return inclusions
  }

  const messageId = activeRun.assistantMessageId ?? activeRun.userMessageId
  return inclusions.map((inclusion) =>
    inclusion.mode !== "provided" && (inclusion.turnId === null || inclusion.messageId === null)
      ? {
          ...inclusion,
          messageId: inclusion.messageId ?? messageId,
          turnId: inclusion.turnId ?? activeRun.turnId
        }
      : inclusion
  )
}

function replaceRuntimeContextInclusions(input: {
  activeRun: JingleActiveAgentRun | null
  existing: AgentContextInclusion[]
  incoming: AgentContextInclusion[]
}): AgentContextInclusion[] {
  const incoming = bindRuntimeContextInclusionsToActiveTurn(input.incoming, input.activeRun)
  if (!input.activeRun) {
    return incoming
  }

  const historical = input.existing.filter(
    (inclusion) =>
      inclusion.mode !== "provided" && (inclusion.turnId !== null || inclusion.messageId !== null)
  )

  return upsertContextInclusions(historical, incoming)
}

function upsertContextInclusions(
  existing: AgentContextInclusion[],
  incoming: AgentContextInclusion[]
): AgentContextInclusion[] {
  const inclusions = [...existing]
  const indexById = new Map(inclusions.map((inclusion, index) => [inclusion.id, index]))

  for (const inclusion of incoming) {
    const existingIndex = indexById.get(inclusion.id)
    if (existingIndex === undefined) {
      indexById.set(inclusion.id, inclusions.length)
      inclusions.push(inclusion)
      continue
    }

    inclusions[existingIndex] = inclusion
  }

  return inclusions
}

function markTruncatedContextInclusionsUnavailable(input: {
  anchorMessage: Message | null
  inclusions: AgentContextInclusion[]
  removedMessageIds: Set<string>
}): AgentContextInclusion[] {
  const truncatedTurnId = input.anchorMessage?.role === "user" ? input.anchorMessage.id : null
  if (input.removedMessageIds.size === 0 && !truncatedTurnId) {
    return input.inclusions
  }

  let changed = false
  const next = input.inclusions.map((inclusion) => {
    const wasRemovedWithMessage =
      inclusion.messageId !== null && input.removedMessageIds.has(inclusion.messageId)
    const wasRemovedWithTurn = truncatedTurnId !== null && inclusion.turnId === truncatedTurnId

    if (
      (!wasRemovedWithMessage && !wasRemovedWithTurn) ||
      inclusion.availability === "unavailable"
    ) {
      return inclusion
    }

    changed = true
    return {
      ...inclusion,
      availability: "unavailable" as const,
      unavailableReason: {
        code: "deleted" as const,
        message: "The message that held this evidence was removed or edited."
      }
    }
  })

  return changed ? next : input.inclusions
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

function mergeMessageToolCalls(
  activeRun: JingleActiveAgentRun | null,
  message: Message
): JingleActiveAgentToolCall[] {
  let toolCalls = activeRun?.toolCalls ?? []

  for (const [index, toolCall] of (message.tool_calls ?? []).entries()) {
    const existingToolCall = toolCalls.find(
      (entry) =>
        entry.id === toolCall.id ||
        (entry.messageId === message.id && entry.index !== null && entry.index === index)
    )
    toolCalls = upsertJingleActiveAgentToolCallInList(toolCalls, {
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
  patch: Partial<JingleActiveAgentRun>
): AgentThreadRuntimeState {
  const activeRun = patchJingleActiveAgentRun(state.activeRun, patch)
  if (!activeRun) {
    return updateRevision(state, revision)
  }

  return {
    ...state,
    activeRun,
    revision
  }
}

function updateActiveRunWithPhaseStart(
  state: AgentThreadRuntimeState,
  revision: number,
  phaseStartedAt: Date,
  patch: Partial<JingleActiveAgentRun>
): AgentThreadRuntimeState {
  if (!state.activeRun) {
    return updateRevision(state, revision)
  }

  const activeRun = patchJingleActiveAgentRunWithPhaseStart(state.activeRun, phaseStartedAt, patch)
  return activeRun ? { ...state, activeRun, revision } : updateRevision(state, revision)
}

function updateRevision(state: AgentThreadRuntimeState, revision: number): AgentThreadRuntimeState {
  return {
    ...state,
    revision
  }
}
