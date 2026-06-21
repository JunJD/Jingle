import { resolveModelRuntimeConfig } from "../model-provider/resolver"
import { createProviderChatModel, type ChatModelInstance } from "../model-provider/sdk"
import type { ThinkingEffort } from "../model-provider/types"

export interface ChatModelOptions {
  modelPreference?: "fast"
  modelId?: string
  parallelToolCalls?: boolean
  temperature?: number
  thinkingEffort?: ThinkingEffort | null
}

export function getChatModelInstance(options: ChatModelOptions = {}): ChatModelInstance {
  const resolvedRuntime = resolveModelRuntimeConfig({
    modelId: options.modelId,
    modelPreference: options.modelPreference,
    thinkingEffort: options.thinkingEffort
  })

  return createProviderChatModel(resolvedRuntime, {
    parallelToolCalls: options.parallelToolCalls,
    temperature: options.temperature
  })
}
