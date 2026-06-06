import type { HITLRequest, Message } from "./app-types"
import type { ActiveAgentRun, AgentRunPhase } from "./agent-thread-runtime"

function getVisibleMessages(messages: Message[]): Message[] {
  return messages.filter((message) => message.role !== "tool")
}

function getVisibleMessagesForTurn(turnId: string, messages: Message[]): Message[] {
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

function getLatestUserMessage(messages: Message[]): Message | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === "user") {
      return message
    }
  }

  return null
}

export function deriveActiveRunFromMessages(input: {
  latestRunId: string | null
  messages: Message[]
  pendingApproval: HITLRequest | null
  threadId: string
  threadStatus: "busy" | "interrupted"
}): ActiveAgentRun | null {
  const latestUser = getLatestUserMessage(input.messages)
  if (!latestUser) {
    return null
  }

  const activeTurnMessages = getVisibleMessagesForTurn(latestUser.id, input.messages)
  const lastAssistant = activeTurnMessages.findLast((message) => message.role === "assistant") ?? null

  if (input.pendingApproval) {
    return {
      assistantMessageId: lastAssistant?.id ?? null,
      phase: "waiting_tool_result",
      runId: input.latestRunId,
      status: "waiting_approval",
      threadId: input.threadId,
      turnId: latestUser.id,
      userMessageId: latestUser.id
    }
  }

  if (input.threadStatus === "interrupted") {
    return {
      assistantMessageId: lastAssistant?.id ?? null,
      phase: lastAssistant ? "waiting_tool_result" : "thinking",
      runId: input.latestRunId,
      status: "running",
      threadId: input.threadId,
      turnId: latestUser.id,
      userMessageId: latestUser.id
    }
  }

  const phase: AgentRunPhase = lastAssistant
    ? (lastAssistant.tool_calls?.length ?? 0) > 0
      ? "tool_running"
      : "streaming"
    : "thinking"

  return {
    assistantMessageId: lastAssistant?.id ?? null,
    phase,
    runId: input.latestRunId,
    status: "running",
    threadId: input.threadId,
    turnId: latestUser.id,
    userMessageId: latestUser.id
  }
}
