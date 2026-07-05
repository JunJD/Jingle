import type { JingleActiveToolCallStatus, JingleRunPhase, JingleRunStatus } from "./profile"

export type JingleActiveAgentToolCallStatus = JingleActiveToolCallStatus

export type JingleAgentRunPhase = JingleRunPhase

export type JingleAgentRunStatus = JingleRunStatus

export interface JingleActiveAgentToolCall {
  argsText: string
  id: string
  index: number | null
  messageId: string | null
  name: string
  runId: string | null
  startedAt: Date
  status: JingleActiveAgentToolCallStatus
}

export interface JingleActiveAgentRun {
  assistantMessageId: string | null
  currentToolCallId: string | null
  phase: JingleAgentRunPhase | null
  phaseStartedAt: Date
  runId: string | null
  startedAt: Date
  status: JingleAgentRunStatus
  threadId: string
  toolCalls: JingleActiveAgentToolCall[]
  turnId: string
  userMessageId: string
}

export function upsertJingleActiveAgentToolCall(
  activeRun: JingleActiveAgentRun | null,
  toolCall: JingleActiveAgentToolCall
): JingleActiveAgentToolCall[] {
  return upsertJingleActiveAgentToolCallInList(activeRun?.toolCalls ?? [], toolCall)
}

export function upsertJingleActiveAgentToolCallInList(
  existingToolCalls: JingleActiveAgentToolCall[],
  toolCall: JingleActiveAgentToolCall
): JingleActiveAgentToolCall[] {
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
  const nextToolCall: JingleActiveAgentToolCall = {
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

export function removeJingleActiveAgentToolCall(
  activeRun: JingleActiveAgentRun | null,
  toolCallId: string
): JingleActiveAgentToolCall[] {
  return (activeRun?.toolCalls ?? []).filter((toolCall) => toolCall.id !== toolCallId)
}

export function updateJingleActiveAgentToolCallRunId(
  activeRun: JingleActiveAgentRun | null,
  runId: string
): JingleActiveAgentToolCall[] {
  return (activeRun?.toolCalls ?? []).map((toolCall) => ({
    ...toolCall,
    runId
  }))
}

export function updateJingleActiveAgentToolCallStatus(
  activeRun: JingleActiveAgentRun | null,
  toolCallId: string,
  status: JingleActiveAgentToolCallStatus,
  startedAt?: Date
): JingleActiveAgentToolCall[] {
  return (activeRun?.toolCalls ?? []).map((toolCall) =>
    toolCall.id === toolCallId
      ? { ...toolCall, ...(startedAt ? { startedAt } : {}), status }
      : toolCall
  )
}

export function patchJingleActiveAgentRun(
  activeRun: JingleActiveAgentRun | null,
  patch: Partial<JingleActiveAgentRun>
): JingleActiveAgentRun | null {
  return activeRun ? { ...activeRun, ...patch } : null
}

export function patchJingleActiveAgentRunWithPhaseStart(
  activeRun: JingleActiveAgentRun | null,
  phaseStartedAt: Date,
  patch: Partial<JingleActiveAgentRun>
): JingleActiveAgentRun | null {
  const nextPatch =
    activeRun && patch.phase && patch.phase !== activeRun.phase
      ? {
          ...patch,
          phaseStartedAt
        }
      : patch

  return patchJingleActiveAgentRun(activeRun, nextPatch)
}
