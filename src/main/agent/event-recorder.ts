import { decodeMessagesStreamPayload, decodeValuesStreamPayload } from "./agent-stream-codec"
import { appendAgentEventSafely, enqueueAgentTraceProjection } from "../db/agent-events"
import { OpenworkIpcError } from "../ipc/error"
import type { HITLDecision } from "../types"

export interface AgentStreamBoundaryRecorderState {
  approvalRequestIds: Set<string>
  assistantMessageIdRef: { value: string | null }
  assistantMessageIds: Set<string>
  completedAssistantMessageIds: Set<string>
  completedToolResultIds: Set<string>
  toolCallIds: Set<string>
}

export function createAgentStreamBoundaryRecorderState(): AgentStreamBoundaryRecorderState {
  return {
    approvalRequestIds: new Set<string>(),
    assistantMessageIdRef: { value: null },
    assistantMessageIds: new Set<string>(),
    completedAssistantMessageIds: new Set<string>(),
    completedToolResultIds: new Set<string>(),
    toolCallIds: new Set<string>()
  }
}

function describeRuntimeErrorForTrace(error: unknown): {
  errorMessage: string
  errorType: string
} {
  if (error instanceof OpenworkIpcError) {
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

export async function recordRunStarted(input: {
  modelId?: string
  permissionMode: string
  runId: string
  threadId: string
  userMessageId: string
}): Promise<void> {
  await appendAgentEventSafely({
    payload: {
      model: input.modelId ?? null,
      permissionMode: input.permissionMode,
      source: "invoke",
      userMessageId: input.userMessageId
    },
    runId: input.runId,
    threadId: input.threadId,
    type: "run.started"
  })
}

export async function recordRunResumed(input: {
  modelId?: string
  requestId: string
  runId: string
  threadId: string
}): Promise<void> {
  await appendAgentEventSafely({
    payload: {
      model: input.modelId ?? null,
      requestId: input.requestId,
      source: "resume"
    },
    runId: input.runId,
    threadId: input.threadId,
    type: "run.resumed"
  })
}

export async function recordUserMessageCreated(input: {
  contentPreview: string
  refs: unknown[]
  runId: string
  threadId: string
  userMessageId: string
}): Promise<void> {
  await appendAgentEventSafely({
    payload: {
      contentPreview: input.contentPreview,
      refs: input.refs,
      userMessageId: input.userMessageId
    },
    runId: input.runId,
    threadId: input.threadId,
    type: "message.user.created"
  })
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
  try {
    await recordAgentStreamBoundaryEventsUnsafe(input)
  } catch (error) {
    console.warn(
      `[AgentEventRecorder] Failed to record stream boundary events for run ${input.runId}:`,
      error
    )
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
      input.state.assistantMessageIdRef.value = decoded.assistant.id
      const contentLength =
        typeof decoded.assistant.content === "string"
          ? decoded.assistant.content.length
          : JSON.stringify(decoded.assistant.content).length

      if (!input.state.assistantMessageIds.has(decoded.assistant.id)) {
        input.state.assistantMessageIds.add(decoded.assistant.id)
        await appendAgentEventSafely({
          payload: {
            messageId: decoded.assistant.id,
            model: input.modelId ?? null
          },
          runId: input.runId,
          threadId: input.threadId,
          type: "message.assistant.started"
        })
      }

      if (
        decoded.assistant.usageMetadata &&
        !input.state.completedAssistantMessageIds.has(decoded.assistant.id)
      ) {
        input.state.completedAssistantMessageIds.add(decoded.assistant.id)
        await appendAgentEventSafely({
          payload: {
            contentLength,
            messageId: decoded.assistant.id,
            model: input.modelId ?? null
          },
          runId: input.runId,
          threadId: input.threadId,
          type: "message.assistant.completed"
        })
      }

      for (const toolCall of decoded.assistant.toolCalls) {
        if (!toolCall.id || input.state.toolCallIds.has(toolCall.id)) {
          continue
        }

        input.state.toolCallIds.add(toolCall.id)
        await appendAgentEventSafely({
          payload: {
            args: toolCall.args ?? null,
            messageId: decoded.assistant.id,
            toolCallId: toolCall.id,
            toolName: toolCall.name ?? null
          },
          runId: input.runId,
          threadId: input.threadId,
          type: "tool.call.started"
        })
      }

      for (const toolCallChunk of decoded.assistant.toolCallChunks) {
        if (!toolCallChunk.id || input.state.toolCallIds.has(toolCallChunk.id)) {
          continue
        }

        input.state.toolCallIds.add(toolCallChunk.id)
        await appendAgentEventSafely({
          payload: {
            args: toolCallChunk.args ?? null,
            messageId: decoded.assistant.id,
            toolCallId: toolCallChunk.id,
            toolName: toolCallChunk.name ?? null
          },
          runId: input.runId,
          threadId: input.threadId,
          type: "tool.call.started"
        })
      }
    }

    if (decoded.tool) {
      await appendAgentEventSafely({
        payload: {
          messageId: decoded.tool.id,
          output: decoded.tool.content,
          status: decoded.tool.status === "error" ? "failed" : "completed",
          toolCallId: decoded.tool.toolCallId,
          toolName: decoded.tool.name ?? null
        },
        runId: input.runId,
        threadId: input.threadId,
        type: decoded.tool.status === "error" ? "tool.call.failed" : "tool.call.completed"
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

  for (const message of decoded.messages ?? []) {
    if (message.role === "assistant") {
      input.state.assistantMessageIdRef.value = message.id
      for (const toolCall of message.tool_calls ?? []) {
        if (!toolCall.id || input.state.toolCallIds.has(toolCall.id)) {
          continue
        }

        input.state.toolCallIds.add(toolCall.id)
        await appendAgentEventSafely({
          payload: {
            args: toolCall.args ?? null,
            messageId: message.id,
            toolCallId: toolCall.id,
            toolName: toolCall.name ?? null
          },
          runId: input.runId,
          threadId: input.threadId,
          type: "tool.call.started"
        })
      }
    }

    if (
      message.role === "tool" &&
      message.tool_call_id &&
      !input.state.completedToolResultIds.has(message.id)
    ) {
      input.state.completedToolResultIds.add(message.id)
      await appendAgentEventSafely({
        payload: {
          messageId: message.id,
          output: message.content,
          status: "completed",
          toolCallId: message.tool_call_id,
          toolName: message.name ?? null
        },
        runId: input.runId,
        threadId: input.threadId,
        type: "tool.call.completed"
      })
    }
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
