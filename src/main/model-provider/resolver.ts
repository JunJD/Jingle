import { DASHSCOPE_BASE_URL, getModelConfig, parseProviderModelId } from "./catalog"
import { getProviderApiKey } from "./secrets"
import { getModelProviderDefaultModel } from "./settings"
import type { ResolvedModelRuntimeConfig } from "./types"

export function resolveModelRuntimeConfig(modelId?: string): ResolvedModelRuntimeConfig {
  const resolvedModelId = modelId || getModelProviderDefaultModel()
  const parsedModelId = parseProviderModelId(resolvedModelId)
  const configuredModel = getModelConfig(resolvedModelId)
  const providerId = parsedModelId.providerId

  return {
    apiKey: getProviderApiKey(providerId),
    modelId: resolvedModelId,
    modelName: configuredModel?.model ?? parsedModelId.modelName,
    options: {
      ...(providerId === "dashscope" ? { baseUrl: DASHSCOPE_BASE_URL } : {})
    },
    providerId
  }
}
