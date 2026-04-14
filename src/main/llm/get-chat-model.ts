import { resolveModelRuntimeConfig } from "../model-provider/resolver"
import { createProviderChatModel, type ChatModelInstance } from "../model-provider/sdk"

export interface ChatModelOptions {
  modelId?: string
  temperature?: number
}

export function getChatModelInstance(options: ChatModelOptions = {}): ChatModelInstance {
  const resolvedRuntime = resolveModelRuntimeConfig(options.modelId)

  return createProviderChatModel(resolvedRuntime, { temperature: options.temperature })
}
