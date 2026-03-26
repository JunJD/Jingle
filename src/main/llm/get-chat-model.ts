import { ChatAnthropic } from "@langchain/anthropic"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { ChatOpenAI } from "@langchain/openai"
import { getDefaultModel, getModelConfig } from "../ipc/models"
import { getApiKey } from "../storage"
import type { ProviderId } from "../types"

const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"

export type ChatModelInstance = ChatAnthropic | ChatOpenAI | ChatGoogleGenerativeAI | string

export interface ChatModelOptions {
  modelId?: string
  temperature?: number
}

export function getChatModelInstance(options: ChatModelOptions = {}): ChatModelInstance {
  const resolvedModelId = options.modelId || getDefaultModel()
  const configuredModel = getModelConfig(resolvedModelId)
  const model = configuredModel?.model ?? resolvedModelId
  const provider = configuredModel?.provider ?? inferProviderFromModelId(resolvedModelId)

  if (provider === "anthropic") {
    const apiKey = getApiKey("anthropic")
    if (!apiKey) {
      throw new Error("Anthropic API key not configured")
    }

    return new ChatAnthropic({
      anthropicApiKey: apiKey,
      model,
      temperature: options.temperature
    })
  }

  if (provider === "openai") {
    const apiKey = getApiKey("openai")
    if (!apiKey) {
      throw new Error("OpenAI API key not configured")
    }

    return new ChatOpenAI({
      apiKey,
      model,
      temperature: options.temperature
    })
  }

  if (provider === "dashscope") {
    const apiKey = getApiKey("dashscope")
    if (!apiKey) {
      throw new Error("DashScope API key not configured")
    }

    return new ChatOpenAI({
      apiKey,
      model,
      temperature: options.temperature,
      configuration: {
        baseURL: DASHSCOPE_BASE_URL
      }
    })
  }

  if (provider === "google") {
    const apiKey = getApiKey("google")
    if (!apiKey) {
      throw new Error("Google API key not configured")
    }

    return new ChatGoogleGenerativeAI({
      apiKey,
      model,
      temperature: options.temperature
    })
  }

  return model
}

export function inferProviderFromModelId(modelId: string): ProviderId | undefined {
  if (modelId.startsWith("claude")) {
    return "anthropic"
  }

  if (
    modelId.startsWith("gpt") ||
    modelId.startsWith("o1") ||
    modelId.startsWith("o3") ||
    modelId.startsWith("o4")
  ) {
    return "openai"
  }

  if (
    modelId.startsWith("glm") ||
    modelId.startsWith("qwen") ||
    modelId.startsWith("deepseek") ||
    modelId.startsWith("qwq")
  ) {
    return "dashscope"
  }

  if (modelId.startsWith("gemini")) {
    return "google"
  }

  return undefined
}
