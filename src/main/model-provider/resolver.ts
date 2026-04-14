import { DASHSCOPE_BASE_URL, getModelConfig, parseProviderModelId } from "./catalog"
import { getProviderApiKey } from "./secrets"
import { getModelProviderDefaultModel } from "./settings"
import type { ResolvedModelRuntimeConfig } from "./types"

export function resolveModelRuntimeConfig(modelId?: string): ResolvedModelRuntimeConfig {
  const resolvedModelId = modelId || getModelProviderDefaultModel("llm")
  const parsedModelId = parseProviderModelId(resolvedModelId)
  const configuredModel = getModelConfig(resolvedModelId)
  const providerId = parsedModelId.providerId
  const modelType = configuredModel?.modelType ?? "llm"

  if (modelType !== "llm") {
    throw new Error(`Model type is not supported by chat runtime: ${modelType}`)
  }

  return {
    apiKey: getProviderApiKey(providerId),
    modelId: resolvedModelId,
    modelName: configuredModel?.model ?? parsedModelId.modelName,
    modelType,
    options: {
      ...(providerId === "dashscope" ? { baseUrl: DASHSCOPE_BASE_URL } : {})
    },
    providerId
  }
}
