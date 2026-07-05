import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages"
import {
  buildJingleTitlePrompt,
  parseJingleGeneratedTitle,
  type JingleTitlePolicyState
} from "./title-policy"

export interface CreateJingleTitleGeneratorInput {
  createModel: () => JingleTitleGenerationModel
  onError?: (error: unknown) => void
  timeoutMs: number
}

export interface JingleTitleGenerationModel {
  withConfig(config: { runName: string }): {
    invoke(
      messages: [SystemMessage, HumanMessage],
      options: { timeout: number }
    ): Promise<{ content: BaseMessage["content"] }>
  }
}

function hasLangChainModelAbortSignal(error: object): boolean {
  const fields = error as { [key: symbol]: unknown }
  return Object.getOwnPropertySymbols(error).some(
    (symbol) => symbol.description === "langchain.error.model-abort" && fields[symbol] === true
  )
}

export function isJingleTitleGenerationAbort(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }

  const record = error as { cause?: unknown; name?: unknown }
  if (record.name === "AbortError" || record.name === "TimeoutError") {
    return true
  }

  if (hasLangChainModelAbortSignal(error)) {
    return true
  }

  return record.cause !== undefined && record.cause !== error
    ? isJingleTitleGenerationAbort(record.cause)
    : false
}

export function createJingleTitleGenerator(
  input: CreateJingleTitleGeneratorInput
): (state: JingleTitlePolicyState) => Promise<string | null> {
  return async (state) => {
    const { prompt, system } = buildJingleTitlePrompt(state)

    try {
      const response = await input
        .createModel()
        .withConfig({ runName: "thread_title" })
        .invoke([new SystemMessage(system), new HumanMessage(prompt)], {
          timeout: input.timeoutMs
        })
      const title = parseJingleGeneratedTitle(response.content)
      return title || null
    } catch (error) {
      if (!isJingleTitleGenerationAbort(error)) {
        input.onError?.(error)
      }
      return null
    }
  }
}
