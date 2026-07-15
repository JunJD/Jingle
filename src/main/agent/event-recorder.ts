import {
  decodeMessagesStreamPayload,
  decodeValuesStreamPayload,
  selectExecutionValuesToolMessages,
  type DecodedToolMessageChunk,
  type DecodedValuesToolMessageChunk
} from "./agent-stream-codec"
import {
  appendAgentEvent,
  appendAgentEventSafely,
  appendAgentEventsSafely,
  enqueueAgentTraceProjection,
  type AppendAgentEventInput
} from "../db/agent-events"
import { JingleIpcError } from "../ipc/error"
import { enqueueThreadDigestProjection } from "../projection/thread-digest-queue"
import { getDevtoolsNetworkRecorder } from "@jingle/devtools-network/main"
import type { HITLDecision } from "../types"

export interface AgentStreamBoundaryRecorderState {
  approvalRequestIds: Set<string>
  assistantMessageIdRef: { value: string | null }
  assistantMessageIds: Set<string>
  completedAssistantMessageIds: Set<string>
  completedToolResultIds: Set<string>
  pendingValuesToolResults: Map<string, DecodedValuesToolMessageChunk>
  targetTurnId: string | null
  toolCallIds: Set<string>
}

export function createAgentStreamBoundaryRecorderState(
  input: {
    initialToolCallIds?: readonly string[]
    targetTurnId?: string | null
  } = {}
): AgentStreamBoundaryRecorderState {
  return {
    approvalRequestIds: new Set<string>(),
    assistantMessageIdRef: { value: null },
    assistantMessageIds: new Set<string>(),
    completedAssistantMessageIds: new Set<string>(),
    completedToolResultIds: new Set<string>(),
    pendingValuesToolResults: new Map<string, DecodedValuesToolMessageChunk>(),
    targetTurnId: input.targetTurnId ?? null,
    toolCallIds: new Set(input.initialToolCallIds)
  }
}

function describeRuntimeErrorForTrace(error: unknown): {
  errorMessage: string
  errorType: string
} {
  if (error instanceof JingleIpcError) {
    return {
      errorMessage: error.message,
      errorType: error.code
    }
  }

  if (error instanceof Error) {
    return {
      errorMessage: error.message,
      errorType: error.name
    }
  }

  return {
    errorMessage: String(error),
    errorType: "Error"
  }
}

function countArrayValue(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null
}

function readRecordValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") {
    return undefined
  }

  return (value as Record<string, unknown>)[key]
}

function summarizeAgentMessagesStreamPayload(data: unknown): Record<string, unknown> {
  const root = readRecordValue(data, "lc_kwargs")
  const payload = root && typeof root === "object" ? root : data
  const toolCallChunks = readRecordValue(payload, "tool_call_chunks")
  const toolCalls = readRecordValue(payload, "tool_calls")
  const usageMetadata = readRecordValue(payload, "usage_metadata")
  const content = readRecordValue(payload, "content")

  return {
    contentLength: typeof content === "string" ? content.length : null,
    hasUsageMetadata: usageMetadata !== undefined && usageMetadata !== null,
    toolCallChunkCount: countArrayValue(toolCallChunks),
    toolCallCount: countArrayValue(toolCalls)
  }
}

function summarizeAgentValuesStreamPayload(
  data: unknown,
  input: { runId: string; threadId: string }
): Record<string, unknown> {
  const decoded = decodeValuesStreamPayload(data, input)

  return {
    contextInclusionCount: decoded.contextInclusions?.length ?? null,
    hasPendingApproval: decoded.pendingApproval !== null,
    lastMessageId: decoded.messages?.at(-1)?.id ?? null,
    messageCount: decoded.messages?.length ?? null,
    todoCount: decoded.todos?.length ?? null
  }
}

function summarizeAgentStreamPayload(input: {
  data: unknown
  mode: string
  runId: string
  threadId: string
}): Record<string, unknown> {
  if (input.mode === "messages") {
    return summarizeAgentMessagesStreamPayload(input.data)
  }

  if (input.mode === "values") {
    return summarizeAgentValuesStreamPayload(input.data, {
      runId: input.runId,
      threadId: input.threadId
    })
  }

  return {
    mode: input.mode
  }
}

function recordAgentStreamForDevtools(input: {
  data: unknown
  mode: string
  modelId?: string
  runId: string
  threadId: string
}): void {
  const recorder = getDevtoolsNetworkRecorder()
  if (!recorder.isEnabled()) {
    return
  }

  try {
    recorder.append({
      channel: `agent:stream:${input.mode}`,
      metadata: {
        mode: input.mode,
        modelId: input.modelId ?? null,
        runId: input.runId,
        threadId: input.threadId
      },
      payload: summarizeAgentStreamPayload(input),
      source: "agent-stream",
      status: "sent"
    })
  } catch (error) {
    console.warn(
      `[AgentEventRecorder] Failed to record stream devtools summary for run ${input.runId}:`,
      error
    )
  }
}

export interface RunStartedEventInput {
  modelId?: string
  permissionMode: string
  runId: string
  threadId: string
  userMessageId: string
}

export function createRunStartedEventInput(input: RunStartedEventInput): AppendAgentEventInput {
  return {
    payload: {
      model: input.modelId ?? null,
      permissionMode: input.permissionMode,
      source: "invoke",
      userMessageId: input.userMessageId
    },
    runId: input.runId,
    threadId: input.threadId,
    type: "run.started"
  }
}

export async function recordRunStarted(input: RunStartedEventInput): Promise<void> {
  await appendAgentEvent(createRunStartedEventInput(input))
}

export interface RunResumedEventInput {
  modelId?: string
  requestId: string
  runId: string
  threadId: string
}

export function createRunResumedEventInput(input: RunResumedEventInput): AppendAgentEventInput {
  return {
    payload: {
      model: input.modelId ?? null,
      requestId: input.requestId,
      source: "resume"
    },
    runId: input.runId,
    threadId: input.threadId,
    type: "run.resumed"
  }
}

export async function recordRunResumed(input: RunResumedEventInput): Promise<void> {
  await appendAgentEvent(createRunResumedEventInput(input))
}

export interface UserMessageCreatedEventInput {
  contentPreview: string
  refs: unknown[]
  runId: string
  threadId: string
  userMessageId: string
}

export function createUserMessageCreatedEventInput(
  input: UserMessageCreatedEventInput
): AppendAgentEventInput {
  return {
    payload: {
      contentPreview: input.contentPreview,
      refs: input.refs,
      userMessageId: input.userMessageId
    },
    runId: input.runId,
    threadId: input.threadId,
    type: "message.user.created"
  }
}

export async function recordUserMessageCreated(input: UserMessageCreatedEventInput): Promise<void> {
  await appendAgentEvent(createUserMessageCreatedEventInput(input))
}

export async function recordApprovalResolved(input: {
  decision: HITLDecision
  requestId: string
  runId: string
  threadId: string
}): Promise<void> {
  await appendAgentEventSafely({
    payload: {
      decision: input.decision.type,
      feedback: input.decision.feedback ?? null,
      requestId: input.requestId,
      toolCallId: input.decision.tool_call_id ?? null
    },
    runId: input.runId,
    threadId: input.threadId,
    type: "approval.resolved"
  })
}

export async function recordRunInterrupted(input: {
  runId: string
  status: "interrupted"
  threadId: string
}): Promise<void> {
  await appendAgentEventSafely({
    payload: {
      status: input.status
    },
    runId: input.runId,
    threadId: input.threadId,
    type: "run.interrupted"
  })
}

export async function recordRunFinished(input: {
  completionReason?: string
  error?: unknown
  runId: string
  status: string
  threadId: string
}): Promise<void> {
  const traceError = input.error ? describeRuntimeErrorForTrace(input.error) : null
  const event = await appendAgentEventSafely({
    payload: {
      completionReason: input.completionReason ?? null,
      errorMessage: traceError?.errorMessage ?? null,
      errorType: traceError?.errorType ?? null,
      status: input.status
    },
    runId: input.runId,
    threadId: input.threadId,
    type: "run.finished"
  })
  if (event) {
    enqueueAgentTraceProjection(input.runId)
    enqueueThreadDigestProjection(input.threadId)
  }
}

export async function recordAgentStreamBoundaryEvents(input: {
  data: unknown
  mode: string
  modelId?: string
  runId: string
  state: AgentStreamBoundaryRecorderState
  threadId: string
}): Promise<void> {
  recordAgentStreamForDevtools(input)

  try {
    await recordAgentStreamBoundaryEventsUnsafe(input)
  } catch (error) {
    console.warn(
      `[AgentEventRecorder] Failed to record stream boundary events for run ${input.runId}:`,
      error
    )
  }
}

type ToolResultRecordOutcome = "duplicate" | "not-recorded" | "recorded"

async function recordToolResultBoundaryEvent(input: {
  result: DecodedToolMessageChunk
  runId: string
  state: AgentStreamBoundaryRecorderState
  threadId: string
}): Promise<ToolResultRecordOutcome> {
  if (input.state.completedToolResultIds.has(input.result.toolCallId)) {
    return "duplicate"
  }

  const event = await appendAgentEventSafely({
    payload: {
      messageId: input.result.id,
      output: input.result.content,
      status: input.result.status === "error" ? "failed" : "completed",
      toolCallId: input.result.toolCallId,
      toolName: input.result.name ?? null
    },
    runId: input.runId,
    threadId: input.threadId,
    type: input.result.status === "error" ? "tool.call.failed" : "tool.call.completed"
  })
  if (event) {
    input.state.completedToolResultIds.add(input.result.toolCallId)
    return "recorded"
  }
  return "not-recorded"
}

async function flushPendingValuesToolResults(input: {
  runId: string
  state: AgentStreamBoundaryRecorderState
  threadId: string
}): Promise<void> {
  for (const [toolCallId, result] of input.state.pendingValuesToolResults) {
    if (!input.state.toolCallIds.has(toolCallId)) {
      continue
    }

    const outcome = await recordToolResultBoundaryEvent({
      result,
      runId: input.runId,
      state: input.state,
      threadId: input.threadId
    })
    if (outcome !== "not-recorded") {
      input.state.pendingValuesToolResults.delete(toolCallId)
    }
  }
}

async function recordAgentStreamBoundaryEventsUnsafe(input: {
  data: unknown
  mode: string
  modelId?: string
  runId: string
  state: AgentStreamBoundaryRecorderState
  threadId: string
}): Promise<void> {
  if (input.mode === "messages") {
    const decoded = decodeMessagesStreamPayload(input.data, input.state.assistantMessageIdRef.value)

    if (decoded.assistant) {
      const assistant = decoded.assistant
      input.state.assistantMessageIdRef.value = assistant.id
      const contentLength =
        typeof assistant.content === "string"
          ? assistant.content.length
          : JSON.stringify(assistant.content).length

      if (!input.state.assistantMessageIds.has(assistant.id)) {
        input.state.assistantMessageIds.add(assistant.id)
        await appendAgentEventSafely({
          payload: {
            messageId: assistant.id,
            model: input.modelId ?? null
          },
          runId: input.runId,
          threadId: input.threadId,
          type: "message.assistant.started"
        })
      }

      if (assistant.usageMetadata && !input.state.completedAssistantMessageIds.has(assistant.id)) {
        input.state.completedAssistantMessageIds.add(assistant.id)
        await appendAgentEventSafely({
          payload: {
            contentLength,
            messageId: assistant.id,
            model: input.modelId ?? null
          },
          runId: input.runId,
          threadId: input.threadId,
          type: "message.assistant.completed"
        })
      }

      const newToolCalls = assistant.toolCalls.filter(
        (toolCall) => toolCall.id && !input.state.toolCallIds.has(toolCall.id)
      )

      const recordedToolCalls = await appendAgentEventsSafely(
        newToolCalls.map((toolCall) => ({
          payload: {
            args: toolCall.args ?? null,
            messageId: assistant.id,
            toolCallId: toolCall.id,
            toolName: toolCall.name ?? null
          },
          runId: input.runId,
          threadId: input.threadId,
          type: "tool.call.started"
        }))
      )
      if (recordedToolCalls.length === newToolCalls.length) {
        for (const toolCall of newToolCalls) {
          input.state.toolCallIds.add(toolCall.id)
        }
      }
      await flushPendingValuesToolResults(input)
    }

    if (decoded.tool) {
      await recordToolResultBoundaryEvent({
        result: decoded.tool,
        runId: input.runId,
        state: input.state,
        threadId: input.threadId
      })
    }
    return
  }

  if (input.mode !== "values") {
    return
  }

  const decoded = decodeValuesStreamPayload(input.data, {
    runId: input.runId,
    threadId: input.threadId
  })

  const valuesToolMessages = decoded.messages
    ? selectExecutionValuesToolMessages({
        allowedToolCallIds: input.state.toolCallIds,
        messages: decoded.messages,
        targetTurnId: input.state.targetTurnId,
        toolMessages: decoded.toolMessages
      })
    : []
  for (const toolMessage of valuesToolMessages) {
    if (input.state.toolCallIds.has(toolMessage.toolCallId)) {
      const outcome = await recordToolResultBoundaryEvent({
        result: toolMessage,
        runId: input.runId,
        state: input.state,
        threadId: input.threadId
      })
      if (outcome !== "not-recorded") {
        input.state.pendingValuesToolResults.delete(toolMessage.toolCallId)
        continue
      }
    }

    input.state.pendingValuesToolResults.set(toolMessage.toolCallId, toolMessage)
  }

  const request = decoded.pendingApproval
  if (!request || input.state.approvalRequestIds.has(request.id)) {
    return
  }

  input.state.approvalRequestIds.add(request.id)
  await appendAgentEventSafely({
    payload: {
      allowedDecisions: request.allowed_decisions,
      requestId: request.id,
      review: request.review ?? null,
      toolArgs: request.tool_call.args,
      toolCallId: request.tool_call.id,
      toolName: request.tool_call.name
    },
    runId: input.runId,
    threadId: input.threadId,
    type: "approval.requested"
  })
}
