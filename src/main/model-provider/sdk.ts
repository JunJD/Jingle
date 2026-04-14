import { ChatAnthropic } from "@langchain/anthropic"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { ChatOpenAI } from "@langchain/openai"
import type { ProviderId, ResolvedModelRuntimeConfig } from "./types"

export type ChatModelInstance = ChatAnthropic | ChatOpenAI | ChatGoogleGenerativeAI

export interface ChatModelOptions {
  temperature?: number
}

type ModelProviderSdkFactory = (
  runtimeConfig: ResolvedModelRuntimeConfig,
  options: ChatModelOptions
) => ChatModelInstance

const MODEL_PROVIDER_SDK_FACTORIES = {
  anthropic: (runtimeConfig, options) => {
    return new ChatAnthropic({
      anthropicApiKey: requireProviderApiKey(runtimeConfig),
      model: runtimeConfig.modelName,
      temperature: options.temperature
    })
  },
  dashscope: (runtimeConfig, options) => {
    return new ChatOpenAI({
      apiKey: requireProviderApiKey(runtimeConfig),
      model: runtimeConfig.modelName,
      temperature: options.temperature,
      configuration: {
        baseURL: runtimeConfig.options.baseUrl
      }
    })
  },
  google: (runtimeConfig, options) => {
    return new ChatGoogleGenerativeAI({
      apiKey: requireProviderApiKey(runtimeConfig),
      model: runtimeConfig.modelName,
      temperature: options.temperature
    })
  },
  openai: (runtimeConfig, options) => {
    return new ChatOpenAI({
      apiKey: requireProviderApiKey(runtimeConfig),
      model: runtimeConfig.modelName,
      temperature: options.temperature
    })
  }
} satisfies Record<ProviderId, ModelProviderSdkFactory>

export function createProviderChatModel(
  runtimeConfig: ResolvedModelRuntimeConfig,
  options: ChatModelOptions = {}
): ChatModelInstance {
  const factory = MODEL_PROVIDER_SDK_FACTORIES[runtimeConfig.providerId]
  return factory(runtimeConfig, options)
}

function requireProviderApiKey(runtimeConfig: ResolvedModelRuntimeConfig): string {
  if (!runtimeConfig.apiKey) {
    throw new Error(`${runtimeConfig.providerId} API key not configured`)
  }

  return runtimeConfig.apiKey
}
