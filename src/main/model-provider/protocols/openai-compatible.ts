import { AsyncLocalStorage } from "node:async_hooks"
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager"
import type { BaseMessage } from "@langchain/core/messages"
import type { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs"
import { ChatOpenAI, type ChatOpenAIFields } from "@langchain/openai"
import {
  parseProviderCorrelationId,
  readProviderRequestIdFromError,
  readProviderResponseIdFromMessage,
  recordProviderExchangeCorrelation,
  type ProviderExchangeCorrelationSink
} from "../provider-exchange-correlation"
import type { ChatModelOptions, ProtocolCreateModelInput } from "./types"

interface ProviderExchangeInvocationState {
  requestIds: string[]
  responseId: string | null
  responseIdConflict: boolean
}

interface ProviderExchangeTransportContext {
  fetch: typeof globalThis.fetch
  run<T>(state: ProviderExchangeInvocationState, operation: () => Promise<T>): Promise<T>
  settle(state: ProviderExchangeInvocationState, error?: unknown): void
}

export function createOpenAICompatibleChatModel(
  input: ProtocolCreateModelInput & {
    apiKey: string
    baseURL?: string
  }
): ChatOpenAI {
  const { apiKey, baseURL, headers, options, runtimeConfig } = input
  const fields: ChatOpenAIFields = {
    apiKey,
    ...createOpenAICompatibleOutputTokenOptions(runtimeConfig.maxOutputTokens),
    model: runtimeConfig.modelName,
    ...createOpenAICompatibleToolCallOptions(
      options,
      runtimeConfig.thinkingEffort,
      runtimeConfig.reasoningEffortTransport
    ),
    temperature: options.temperature,
    ...(baseURL || headers
      ? {
          configuration: {
            ...(baseURL ? { baseURL } : {}),
            ...(headers ? { defaultHeaders: headers } : {})
          }
        }
      : {})
  }

  return options.providerExchangeCorrelationSink
    ? new ProviderCorrelatedChatOpenAI(fields, options.providerExchangeCorrelationSink)
    : new ChatOpenAI(fields)
}

class ProviderCorrelatedChatOpenAI extends ChatOpenAI {
  private readonly correlation: ProviderExchangeTransportContext
  private readonly correlationSink: ProviderExchangeCorrelationSink
  private readonly providerFields: ChatOpenAIFields

  constructor(fields: ChatOpenAIFields, sink: ProviderExchangeCorrelationSink) {
    const correlation = createProviderExchangeTransportContext(
      sink,
      fields.configuration?.fetch ?? globalThis.fetch.bind(globalThis)
    )
    super({
      ...fields,
      configuration: {
        ...fields.configuration,
        fetch: correlation.fetch
      }
    })
    this.correlation = correlation
    this.correlationSink = sink
    this.providerFields = fields
  }

  override withConfig(config: Parameters<ChatOpenAI["withConfig"]>[0]) {
    const model = new ProviderCorrelatedChatOpenAI(this.providerFields, this.correlationSink)
    model.defaultOptions = {
      ...this.defaultOptions,
      ...config
    }
    return model
  }

  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const state = createProviderExchangeInvocationState()
    return this.correlation.run(state, async () => {
      try {
        const result = await super._generate(messages, options, runManager)
        for (const generation of result.generations) {
          observeProviderResponseId(state, readProviderResponseIdFromMessage(generation.message))
        }
        this.correlation.settle(state)
        return result
      } catch (error) {
        this.correlation.settle(state, error)
        throw error
      }
    })
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    const state = createProviderExchangeInvocationState()
    const iterator = super._streamResponseChunks(messages, options, runManager)
    let completed = false
    let operationError: unknown
    try {
      while (true) {
        const next = await this.correlation.run(state, () => iterator.next())
        if (next.done) {
          completed = true
          break
        }
        observeProviderResponseId(state, readProviderResponseIdFromMessage(next.value.message))
        yield next.value
      }
    } catch (error) {
      operationError = error
      throw error
    } finally {
      if (completed) {
        this.correlation.settle(state, operationError)
      } else {
        await closeProviderStream(this.correlation, state, iterator, operationError)
      }
    }
  }
}

async function closeProviderStream(
  correlation: ProviderExchangeTransportContext,
  state: ProviderExchangeInvocationState,
  iterator: AsyncGenerator<ChatGenerationChunk>,
  operationError: unknown
): Promise<void> {
  try {
    await correlation.run(state, () => iterator.return(undefined))
  } catch (cleanupError) {
    correlation.settle(state, operationError ?? cleanupError)
    if (operationError === undefined) {
      throw cleanupError
    }
    return
  }
  correlation.settle(state, operationError)
}

function createProviderExchangeTransportContext(
  sink: ProviderExchangeCorrelationSink,
  delegateFetch: typeof globalThis.fetch
): ProviderExchangeTransportContext {
  const invocationStorage = new AsyncLocalStorage<ProviderExchangeInvocationState>()
  return {
    fetch: async (request, init) => {
      const response = await delegateFetch(request, init)
      const state = invocationStorage.getStore()
      const requestId = response.headers.get("x-request-id")
      if (state && requestId) {
        recordRequestId(state, requestId)
      }
      return response
    },
    run: (state, operation) => invocationStorage.run(state, operation),
    settle: (state, error) => {
      const errorRequestId = readProviderRequestIdFromError(error)
      if (errorRequestId && !state.requestIds.includes(errorRequestId)) {
        state.requestIds.push(errorRequestId)
      }
      const responseId = state.responseIdConflict ? null : state.responseId
      if (state.requestIds.length === 0) {
        recordProviderExchangeCorrelation(sink, { providerResponseId: responseId })
        return
      }
      state.requestIds.forEach((providerRequestId, index) => {
        recordProviderExchangeCorrelation(sink, {
          providerRequestId,
          ...(index === state.requestIds.length - 1 && responseId
            ? { providerResponseId: responseId }
            : {})
        })
      })
    }
  }
}

function createProviderExchangeInvocationState(): ProviderExchangeInvocationState {
  return {
    requestIds: [],
    responseId: null,
    responseIdConflict: false
  }
}

function recordRequestId(state: ProviderExchangeInvocationState, value: string): void {
  const providerRequestId = parseProviderCorrelationId(value)
  if (!providerRequestId) {
    return
  }
  state.requestIds.push(providerRequestId)
}

function observeProviderResponseId(
  state: ProviderExchangeInvocationState,
  providerResponseId: string | null
): void {
  if (!providerResponseId || state.responseIdConflict) {
    return
  }
  if (state.responseId && state.responseId !== providerResponseId) {
    state.responseId = null
    state.responseIdConflict = true
    return
  }
  state.responseId = providerResponseId
}

function createOpenAICompatibleOutputTokenOptions(maxOutputTokens: number | undefined): {
  maxTokens?: number
} {
  return maxOutputTokens === undefined ? {} : { maxTokens: maxOutputTokens }
}

export function createOpenAICompatibleToolCallOptions(
  options: ChatModelOptions,
  thinkingEffort?: ProtocolCreateModelInput["runtimeConfig"]["thinkingEffort"],
  transport?: ProtocolCreateModelInput["runtimeConfig"]["reasoningEffortTransport"]
): {
  modelKwargs?: Record<string, unknown>
} {
  const modelKwargs: Record<string, unknown> = {}
  if (options.parallelToolCalls === false) {
    modelKwargs.parallel_tool_calls = false
  }

  const reasoningEffort = toOpenAIReasoningEffort(thinkingEffort, transport)
  if (reasoningEffort) {
    modelKwargs.reasoning_effort = reasoningEffort
  }

  return Object.keys(modelKwargs).length > 0 ? { modelKwargs } : {}
}

function toOpenAIReasoningEffort(
  thinkingEffort: ProtocolCreateModelInput["runtimeConfig"]["thinkingEffort"],
  transport: ProtocolCreateModelInput["runtimeConfig"]["reasoningEffortTransport"]
): "off" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  if (thinkingEffort === null || thinkingEffort === undefined) {
    return undefined
  }
  if (transport !== "openai-compatible" && transport !== "openai-native") {
    throw new Error(
      `OpenAI-compatible transport does not admit thinking effort "${thinkingEffort}".`
    )
  }
  if (thinkingEffort === "off") {
    return transport === "openai-native" ? "none" : "off"
  }
  if (
    thinkingEffort === "minimal" ||
    thinkingEffort === "low" ||
    thinkingEffort === "medium" ||
    thinkingEffort === "high" ||
    thinkingEffort === "xhigh" ||
    thinkingEffort === "max"
  ) {
    return thinkingEffort
  }

  return undefined
}

export function isOpenAIChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()
  return (
    isChatCandidate(normalizedModelId) &&
    (normalizedModelId.startsWith("gpt-") ||
      normalizedModelId.startsWith("chatgpt-") ||
      /^o\d/.test(normalizedModelId))
  )
}

export function isDashScopeChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()
  const supportedPrefixes = [
    "abab",
    "baichuan",
    "deepseek-",
    "glm-",
    "moonshot-",
    "qwen",
    "qwq-",
    "yi-"
  ]

  return (
    isChatCandidate(normalizedModelId) &&
    supportedPrefixes.some((prefix) => normalizedModelId.startsWith(prefix))
  )
}

export function isDeepSeekChatModel(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()

  return (
    isChatCandidate(normalizedModelId) &&
    (normalizedModelId.startsWith("deepseek-") || normalizedModelId.startsWith("deepseek_v"))
  )
}

export function isCustomProviderChatModel(modelId: string): boolean {
  return isChatCandidate(modelId.toLowerCase())
}

export function isChatCandidate(normalizedModelId: string): boolean {
  const blockedFragments = [
    "audio",
    "dall-e",
    "embedding",
    "image",
    "moderation",
    "rerank",
    "realtime",
    "speech",
    "tts",
    "transcribe",
    "video",
    "whisper"
  ]

  return !blockedFragments.some((fragment) => normalizedModelId.includes(fragment))
}
