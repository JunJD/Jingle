import { resolveModelRuntimeConfig } from "../model-provider/resolver"
import { createProviderChatModel, type ChatModelInstance } from "../model-provider/sdk"

export interface ChatModelOptions {
  modelId?: string
  parallelToolCalls?: boolean
  temperature?: number
}

export function getChatModelInstance(options: ChatModelOptions = {}): ChatModelInstance {
  const resolvedRuntime = resolveModelRuntimeConfig(options.modelId)

  return createProviderChatModel(resolvedRuntime, {
    parallelToolCalls: options.parallelToolCalls,
    temperature: options.temperature
  })
}
