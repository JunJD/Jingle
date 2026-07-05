import type { JingleActiveAgentRun, JingleAgentRunPhase } from "./live-state"

export interface JingleRunBootstrapToolCall {
  args?: unknown
  id: string
  name: string
}

export interface JingleRunBootstrapMessage {
  created_at: Date
  id: string
  role: string
  tool_calls?: readonly JingleRunBootstrapToolCall[] | null
}

export interface JingleRunBootstrapPendingApproval {
  tool_call: {
    args?: unknown
    id: string
    name: string
  }
}

export type JingleRunBootstrapThreadStatus = "busy" | "interrupted"

function getVisibleMessages<TMessage extends JingleRunBootstrapMessage>(
  messages: readonly TMessage[]
): TMessage[] {
  return messages.filter((message) => message.role !== "tool")
}

function getVisibleMessagesForTurn<TMessage extends JingleRunBootstrapMessage>(
  turnId: string,
  messages: readonly TMessage[]
): TMessage[] {
  const visibleMessages = getVisibleMessages(messages)
  const turnStartIndex = visibleMessages.findIndex(
    (message) => message.role === "user" && message.id === turnId
  )
  if (turnStartIndex < 0) {
    return []
  }

  const nextTurnStartIndex = visibleMessages.findIndex(
    (message, index) => index > turnStartIndex && message.role === "user"
  )
  const turnEndIndex = nextTurnStartIndex < 0 ? visibleMessages.length : nextTurnStartIndex
  return visibleMessages.slice(turnStartIndex, turnEndIndex)
}

function getLatestUserMessage<TMessage extends JingleRunBootstrapMessage>(
  messages: readonly TMessage[]
): TMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === "user") {
      return message
    }
  }

  return null
}

function getActiveRunStartedAt(input: {
  lastAssistant: JingleRunBootstrapMessage | null
  latestUser: JingleRunBootstrapMessage
  pendingApproval: JingleRunBootstrapPendingApproval | null
}): Date {
  return input.pendingApproval
    ? (input.lastAssistant?.created_at ?? input.latestUser.created_at)
    : input.latestUser.created_at
}

export function deriveJingleActiveRunFromMessages(input: {
  latestRunId: string | null
  messages: readonly JingleRunBootstrapMessage[]
  pendingApproval: JingleRunBootstrapPendingApproval | null
  threadId: string
  threadStatus: JingleRunBootstrapThreadStatus
}): JingleActiveAgentRun | null {
  const latestUser = getLatestUserMessage(input.messages)
  if (!latestUser) {
    return null
  }

  const activeTurnMessages = getVisibleMessagesForTurn(latestUser.id, input.messages)
  const lastAssistant =
    activeTurnMessages.findLast((message) => message.role === "assistant") ?? null
  const startedAt = getActiveRunStartedAt({
    lastAssistant,
    latestUser,
    pendingApproval: input.pendingApproval
  })

  if (input.pendingApproval) {
    return {
      assistantMessageId: lastAssistant?.id ?? null,
      currentToolCallId: input.pendingApproval.tool_call.id,
      phase: "waiting_tool_result",
      phaseStartedAt: startedAt,
      runId: input.latestRunId,
      startedAt,
      status: "waiting_approval",
      threadId: input.threadId,
      toolCalls: [
        {
          argsText: JSON.stringify(input.pendingApproval.tool_call.args ?? {}),
          id: input.pendingApproval.tool_call.id,
          index: null,
          messageId: lastAssistant?.id ?? null,
          name: input.pendingApproval.tool_call.name,
          runId: input.latestRunId,
          startedAt,
          status: "waiting_result"
        }
      ],
      turnId: latestUser.id,
      userMessageId: latestUser.id
    }
  }

  if (input.threadStatus === "interrupted") {
    return {
      assistantMessageId: lastAssistant?.id ?? null,
      currentToolCallId: null,
      phase: lastAssistant ? "waiting_tool_result" : "thinking",
      phaseStartedAt: startedAt,
      runId: input.latestRunId,
      startedAt,
      status: "running",
      threadId: input.threadId,
      toolCalls: [],
      turnId: latestUser.id,
      userMessageId: latestUser.id
    }
  }

  const phase: JingleAgentRunPhase = lastAssistant
    ? (lastAssistant.tool_calls?.length ?? 0) > 0
      ? "tool_running"
      : "streaming"
    : "thinking"

  return {
    assistantMessageId: lastAssistant?.id ?? null,
    currentToolCallId: lastAssistant?.tool_calls?.at(-1)?.id ?? null,
    phase,
    phaseStartedAt: lastAssistant?.created_at ?? latestUser.created_at,
    runId: input.latestRunId,
    startedAt,
    status: "running",
    threadId: input.threadId,
    toolCalls: [],
    turnId: latestUser.id,
    userMessageId: latestUser.id
  }
}
