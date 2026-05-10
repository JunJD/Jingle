import { resolveModelRuntimeConfig } from "../model-provider/resolver"
import { createProviderChatModel, type ChatModelInstance } from "../model-provider/sdk"

export interface ChatModelOptions {
  modelPreference?: "fast"
  modelId?: string
  parallelToolCalls?: boolean
  temperature?: number
}

export function getChatModelInstance(options: ChatModelOptions = {}): ChatModelInstance {
  const resolvedRuntime = resolveModelRuntimeConfig({
    modelId: options.modelId,
    modelPreference: options.modelPreference
  })

  return createProviderChatModel(resolvedRuntime, {
    parallelToolCalls: options.parallelToolCalls,
    temperature: options.temperature
  })
}
