import { ChatOpenAI } from "@langchain/openai"
import type { ChatModelOptions, ProtocolCreateModelInput } from "./types"

export function createOpenAICompatibleChatModel(
  input: ProtocolCreateModelInput & {
    apiKey: string
    baseURL?: string
  }
): ChatOpenAI {
  const { apiKey, baseURL, headers, options, runtimeConfig } = input

  return new ChatOpenAI({
    apiKey,
    ...createOpenAICompatibleOutputTokenOptions(runtimeConfig.maxOutputTokens),
    model: runtimeConfig.modelName,
    ...createOpenAICompatibleToolCallOptions(options, runtimeConfig.thinkingEffort),
    temperature: options.temperature,
    ...(baseURL || headers
      ? {
          configuration: {
            ...(baseURL ? { baseURL } : {}),
            ...(headers ? { defaultHeaders: headers } : {})
          }
        }
      : {})
  })
}

function createOpenAICompatibleOutputTokenOptions(maxOutputTokens: number | undefined): {
  maxTokens?: number
} {
  return maxOutputTokens === undefined ? {} : { maxTokens: maxOutputTokens }
}

export function createOpenAICompatibleToolCallOptions(
  options: ChatModelOptions,
  thinkingEffort?: ProtocolCreateModelInput["runtimeConfig"]["thinkingEffort"]
): {
  modelKwargs?: Record<string, unknown>
} {
  const modelKwargs: Record<string, unknown> = {}
  if (options.parallelToolCalls === false) {
    modelKwargs.parallel_tool_calls = false
  }

  const reasoningEffort = toOpenAIReasoningEffort(thinkingEffort)
  if (reasoningEffort) {
    modelKwargs.reasoning_effort = reasoningEffort
  }

  return Object.keys(modelKwargs).length > 0 ? { modelKwargs } : {}
}

function toOpenAIReasoningEffort(
  thinkingEffort: ProtocolCreateModelInput["runtimeConfig"]["thinkingEffort"]
): "low" | "medium" | "high" | undefined {
  if (thinkingEffort === "low" || thinkingEffort === "medium" || thinkingEffort === "high") {
    return thinkingEffort
  }

  if (thinkingEffort === "max") {
    return "high"
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
