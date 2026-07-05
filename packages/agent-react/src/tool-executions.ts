import type { JingleAgentToolExecutionViewStatus } from "./activity-summary"

export interface JingleToolExecutionToolCallSource {
  id: string
}

export interface JingleToolExecutionAssistantSource<
  TToolCall extends JingleToolExecutionToolCallSource = JingleToolExecutionToolCallSource
> {
  toolCalls?: readonly TToolCall[] | null
}

export interface JingleToolExecutionStatusSource {
  status?: string
}

export interface JingleToolExecutionResultSource<
  TExecution extends JingleToolExecutionStatusSource = JingleToolExecutionStatusSource
> {
  execution?: TExecution | null
}

export interface JingleTurnToolExecutionsSource<
  TExecution extends JingleToolExecutionStatusSource = JingleToolExecutionStatusSource,
  TToolCall extends JingleToolExecutionToolCallSource = JingleToolExecutionToolCallSource
> {
  assistants: readonly JingleToolExecutionAssistantSource<TToolCall>[]
  toolResults: Pick<Map<string, JingleToolExecutionResultSource<TExecution>>, "get" | "has">
}

export interface JinglePendingApprovalSource {
  toolCall: JingleToolExecutionToolCallSource
}

export interface JingleActiveToolExecutionSource {
  id: string
  status: JingleAgentToolExecutionViewStatus
}

export interface JingleAgentToolExecutionView<
  TExecution extends JingleToolExecutionStatusSource = JingleToolExecutionStatusSource,
  TActiveToolCall extends JingleActiveToolExecutionSource = JingleActiveToolExecutionSource
> {
  activeToolCall?: TActiveToolCall
  execution?: TExecution | null
  status: JingleAgentToolExecutionViewStatus
  toolCallId: string
}

export type JingleAgentToolExecutionsView<
  TExecution extends JingleToolExecutionStatusSource = JingleToolExecutionStatusSource,
  TActiveToolCall extends JingleActiveToolExecutionSource = JingleActiveToolExecutionSource
> = Record<string, JingleAgentToolExecutionView<TExecution, TActiveToolCall>>

const EMPTY_JINGLE_AGENT_TOOL_EXECUTIONS_VIEW: JingleAgentToolExecutionsView = {}

export function getJingleTurnPendingApproval<
  TPendingApproval extends JinglePendingApprovalSource
>(
  turn: JingleTurnToolExecutionsSource,
  pendingApproval: TPendingApproval | null | undefined
): TPendingApproval | null {
  if (!pendingApproval) {
    return null
  }

  const pendingToolCallId = pendingApproval.toolCall.id
  const belongsToTurn = turn.assistants.some((message) =>
    message.toolCalls?.some((toolCall) => toolCall.id === pendingToolCallId)
  )

  return belongsToTurn ? pendingApproval : null
}

export function projectJingleTurnPendingApproval<
  TPendingApproval extends JinglePendingApprovalSource,
  TActiveToolCall extends JingleActiveToolExecutionSource
>(input: {
  activeToolCalls?: readonly TActiveToolCall[]
  isActiveTurn: boolean
  pendingApproval: TPendingApproval | null | undefined
  turn: JingleTurnToolExecutionsSource | null
}): TPendingApproval | null {
  if (!input.turn || !input.pendingApproval) {
    return null
  }

  const persistedTurnApproval = getJingleTurnPendingApproval(input.turn, input.pendingApproval)
  if (persistedTurnApproval) {
    return persistedTurnApproval
  }

  if (!input.isActiveTurn) {
    return null
  }

  const pendingToolCallId = input.pendingApproval.toolCall.id
  const belongsToActiveTool = (input.activeToolCalls ?? []).some(
    (toolCall) => toolCall.id === pendingToolCallId
  )

  return belongsToActiveTool ? input.pendingApproval : null
}

export function projectJingleTurnToolExecutionsView<
  TExecution extends JingleToolExecutionStatusSource = JingleToolExecutionStatusSource,
  TActiveToolCall extends JingleActiveToolExecutionSource = JingleActiveToolExecutionSource
>(input: {
  activeToolCallId: string | null
  activeToolCalls?: readonly TActiveToolCall[]
  pendingApproval: JinglePendingApprovalSource | null
  turn: JingleTurnToolExecutionsSource<TExecution> | null
}): JingleAgentToolExecutionsView<TExecution, TActiveToolCall> {
  if (!input.turn) {
    return EMPTY_JINGLE_AGENT_TOOL_EXECUTIONS_VIEW as JingleAgentToolExecutionsView<
      TExecution,
      TActiveToolCall
    >
  }

  const nextToolExecutions = new Map<
    string,
    JingleAgentToolExecutionView<TExecution, TActiveToolCall>
  >()

  for (const activeToolCall of input.activeToolCalls ?? []) {
    nextToolExecutions.set(activeToolCall.id, {
      activeToolCall,
      status: activeToolCall.status,
      toolCallId: activeToolCall.id
    })
  }

  for (const assistant of input.turn.assistants) {
    for (const toolCall of assistant.toolCalls ?? []) {
      if (input.turn.toolResults.has(toolCall.id)) {
        const result = input.turn.toolResults.get(toolCall.id)!
        nextToolExecutions.set(toolCall.id, {
          ...(result.execution ? { execution: result.execution } : {}),
          status: result.execution?.status === "failed" ? "failed" : "complete",
          toolCallId: toolCall.id
        })
        continue
      }

      const activeExecution = nextToolExecutions.get(toolCall.id)
      if (activeExecution) {
        nextToolExecutions.set(toolCall.id, activeExecution)
        continue
      }

      if (input.activeToolCallId && toolCall.id === input.activeToolCallId) {
        nextToolExecutions.set(toolCall.id, {
          status: "running",
          toolCallId: toolCall.id
        })
      }
    }
  }

  const pendingApprovalToolCallId = getJingleTurnPendingApproval(
    input.turn,
    input.pendingApproval
  )?.toolCall.id
  if (pendingApprovalToolCallId) {
    nextToolExecutions.set(pendingApprovalToolCallId, {
      status: "approval",
      toolCallId: pendingApprovalToolCallId
    })
  }

  return nextToolExecutions.size === 0
    ? (EMPTY_JINGLE_AGENT_TOOL_EXECUTIONS_VIEW as JingleAgentToolExecutionsView<
        TExecution,
        TActiveToolCall
      >)
    : Object.fromEntries(nextToolExecutions)
}
