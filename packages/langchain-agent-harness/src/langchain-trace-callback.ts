import { BaseCallbackHandler } from "@langchain/core/callbacks/base"
import type { Serialized } from "@langchain/core/load/serializable"
import type { LLMResult } from "@langchain/core/outputs"
import { summarizeJingleLangChainTraceMessages } from "./langchain-message-reader"

export type JingleLangChainTraceEventType = "llm.input.captured" | "llm.output.captured"

export type JingleLangChainTraceEventPayload = Record<string, unknown>

export interface JingleLangChainTraceEvent {
  payload: JingleLangChainTraceEventPayload
  type: JingleLangChainTraceEventType
}

export interface CreateJingleLangChainTraceCallbackInput {
  modelId?: string
  recordEvent(event: JingleLangChainTraceEvent): Promise<void>
  skippedRunNames?: ReadonlySet<string>
}

const DEFAULT_SKIPPED_RUN_NAMES = new Set(["thread_title"])

function readSerializedName(serialized: Serialized): string | null {
  return serialized.name ?? serialized.id.at(-1) ?? null
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

export function createJingleLangChainTraceCallback(
  input: CreateJingleLangChainTraceCallbackInput
): BaseCallbackHandler {
  const skippedLlmRunIds = new Set<string>()
  const skippedRunNames = input.skippedRunNames ?? DEFAULT_SKIPPED_RUN_NAMES

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
      if (runName && skippedRunNames.has(runName)) {
        skippedLlmRunIds.add(llmRunId)
        return
      }

      const messages = messageGroups[0] ?? []
      const messageSummary = summarizeJingleLangChainTraceMessages(messages)
      await input.recordEvent({
        payload: {
          extraParams: extraParams ?? {},
          inputHash: messageSummary.inputHash,
          llmRunId,
          messageCount: messageSummary.messageCount,
          model: input.modelId ?? readSerializedName(llm),
          preview: messageSummary.preview,
          provider: readSerializedName(llm),
          runName: runName ?? null
        },
        type: "llm.input.captured"
      })
    },
    async handleLLMEnd(output, llmRunId) {
      if (skippedLlmRunIds.delete(llmRunId)) {
        return
      }

      const usage = readUsageFromResult(output)
      await input.recordEvent({
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
        type: "llm.output.captured"
      })
    },
    async handleLLMError(error, llmRunId) {
      if (skippedLlmRunIds.delete(llmRunId)) {
        return
      }

      const traceError = describeError(error)
      await input.recordEvent({
        payload: {
          errorMessage: traceError.errorMessage,
          errorType: traceError.errorType,
          llmRunId,
          model: input.modelId ?? null
        },
        type: "llm.output.captured"
      })
    }
  })
}
