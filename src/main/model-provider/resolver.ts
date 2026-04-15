import { getProviderAdapter } from "./adapters"
import { getModelConfig, parseProviderModelId } from "./catalog"
import { getModelProviderDefaultModel } from "./settings"
import type { ResolvedModelRuntimeConfig } from "./types"

export function resolveModelRuntimeConfig(modelId?: string): ResolvedModelRuntimeConfig {
  const resolvedModelId = modelId || getModelProviderDefaultModel("llm")
  const parsedModelId = parseProviderModelId(resolvedModelId)
  const configuredModel = getModelConfig(resolvedModelId)
  const providerId = parsedModelId.providerId
  const modelType = configuredModel?.modelType ?? "llm"
  const credentials = getProviderAdapter(providerId).getCredentials()

  if (modelType !== "llm") {
    throw new Error(`Model type is not supported by chat runtime: ${modelType}`)
  }

  if (!credentials) {
    throw new Error(`Model provider credentials are not configured: ${providerId}`)
  }

  return {
    credentials,
    modelId: resolvedModelId,
    modelName: configuredModel?.model ?? parsedModelId.modelName,
    modelType,
    providerId
  }
}
