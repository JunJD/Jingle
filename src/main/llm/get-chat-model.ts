import { resolveModelRuntimeConfig } from "../model-provider/resolver"
import { createProviderChatModel, type ChatModelInstance } from "../model-provider/sdk"
import type { ModelRuntimeSelection, ThinkingEffort } from "../model-provider/types"

interface ChatModelCommonOptions {
  maxOutputTokens?: number
  parallelToolCalls?: boolean
  temperature?: number
}

export type ChatModelOptions = ChatModelCommonOptions &
  (
    | { selection: ModelRuntimeSelection }
    | { modelPreference: "fast"; thinkingEffort: ThinkingEffort | null }
  )

export function getChatModelInstance(options: ChatModelOptions): ChatModelInstance {
  const resolvedRuntime = resolveModelRuntimeConfig(
    "selection" in options
      ? { selection: options.selection }
      : {
          modelPreference: options.modelPreference,
          thinkingEffort: options.thinkingEffort
        }
  )
  const runtimeConfig =
    options.maxOutputTokens === undefined
      ? resolvedRuntime
      : {
          ...resolvedRuntime,
          maxOutputTokens: options.maxOutputTokens
        }

  return createProviderChatModel(runtimeConfig, {
    parallelToolCalls: options.parallelToolCalls,
    temperature: options.temperature
  })
}
