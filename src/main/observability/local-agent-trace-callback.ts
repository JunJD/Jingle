import { BaseCallbackHandler } from "@langchain/core/callbacks/base"
import type { BaseMessage } from "@langchain/core/messages"
import type { LLMResult } from "@langchain/core/outputs"
import type { Serialized } from "@langchain/core/load/serializable"
import { appendAgentEventSafely } from "../db/agent-events"

const NON_AGENT_EXECUTION_RUN_NAMES = new Set(["thread_title"])

export interface LocalAgentTraceCallbackInput {
  modelId?: string
  runId: string
  threadId: string
}

function readSerializedName(serialized: Serialized): string | null {
  return serialized.name ?? serialized.id.at(-1) ?? null
}

function serializeMessage(message: BaseMessage): Record<string, unknown> {
  const stored = message.toDict()
  return {
    id: stored.data.id ?? null,
    role: stored.data.role ?? stored.type,
    type: stored.type,
    content: stored.data.content,
    name: stored.data.name ?? null,
    toolCallId: stored.data.tool_call_id ?? null,
    additionalKwargs: stored.data.additional_kwargs ?? {},
    responseMetadata: stored.data.response_metadata ?? {}
  }
}

function readUsageFromResult(output: LLMResult): {
  inputTokens: number
  outputTokens: number
  totalTokens: number
} {
  const usage = output.llmOutput?.tokenUsage ?? output.llmOutput?.usage ?? {}
  const inputTokens =
    typeof usage.input_tokens === "number"
      ? usage.input_tokens
      : typeof usage.promptTokens === "number"
        ? usage.promptTokens
        : 0
  const outputTokens =
    typeof usage.output_tokens === "number"
      ? usage.output_tokens
      : typeof usage.completionTokens === "number"
        ? usage.completionTokens
        : 0
  const totalTokens =
    typeof usage.total_tokens === "number"
      ? usage.total_tokens
      : typeof usage.totalTokens === "number"
        ? usage.totalTokens
        : inputTokens + outputTokens

  return {
    inputTokens,
    outputTokens,
    totalTokens
  }
}

function describeError(error: unknown): {
  errorMessage: string
  errorType: string
} {
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

export function createLocalAgentTraceCallback(
  input: LocalAgentTraceCallbackInput
): BaseCallbackHandler {
  const skippedLlmRunIds = new Set<string>()

  return BaseCallbackHandler.fromMethods({
    async handleChatModelStart(
      llm,
      messageGroups,
      llmRunId,
      _parentRunId,
      extraParams,
      _tags,
      _metadata,
      runName
    ) {
      if (runName && NON_AGENT_EXECUTION_RUN_NAMES.has(runName)) {
        skippedLlmRunIds.add(llmRunId)
        return
      }

      const messages = messageGroups[0] ?? []
      await appendAgentEventSafely({
        payload: {
          extraParams: extraParams ?? {},
          input: {
            messages: messages.map(serializeMessage)
          },
          llmRunId,
          messagesBaseline: messages.map(serializeMessage),
          model: input.modelId ?? readSerializedName(llm),
          provider: readSerializedName(llm),
          runName: runName ?? null
        },
        runId: input.runId,
        threadId: input.threadId,
        type: "llm.input.captured"
      })
    },
    async handleLLMEnd(output, llmRunId) {
      if (skippedLlmRunIds.delete(llmRunId)) {
        return
      }

      const usage = readUsageFromResult(output)
      await appendAgentEventSafely({
        payload: {
          inputTokens: usage.inputTokens,
          llmRunId,
          model: input.modelId ?? null,
          output: output.generations.map((generationGroup) =>
            generationGroup.map((generation) => ({
              text: generation.text,
              generationInfo: generation.generationInfo ?? {}
            }))
          ),
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens
        },
        runId: input.runId,
        threadId: input.threadId,
        type: "llm.output.captured"
      })
    },
    async handleLLMError(error, llmRunId) {
      if (skippedLlmRunIds.delete(llmRunId)) {
        return
      }

      const traceError = describeError(error)
      await appendAgentEventSafely({
        payload: {
          errorMessage: traceError.errorMessage,
          errorType: traceError.errorType,
          llmRunId,
          model: input.modelId ?? null
        },
        runId: input.runId,
        threadId: input.threadId,
        type: "llm.output.captured"
      })
    }
  })
}
