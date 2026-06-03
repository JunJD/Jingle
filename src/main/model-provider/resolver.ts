import { getProviderAdapter } from "./adapters"
import { getModelConfig, listModelCatalog, parseProviderModelId } from "./catalog"
import { getModelProviderDefaultModel, getModelProviderDefaultModelOptions } from "./settings"
import type { ResolvedModelRuntimeConfig } from "./types"

export interface ResolveModelRuntimeConfigOptions {
  modelPreference?: "fast"
  modelId?: string
}

const FAST_MODEL_CANDIDATE_IDS = [
  "openai:gpt-4.1-nano",
  "google:gemini-2.5-flash-lite",
  "deepseek:deepseek-v4-flash",
  "anthropic:claude-haiku-4-5-20251001",
  "dashscope:qwen-plus"
]

export function resolveModelRuntimeConfig(
  options: ResolveModelRuntimeConfigOptions = {}
): ResolvedModelRuntimeConfig {
  const resolvedModelId = options.modelId || resolvePreferredModelId(options.modelPreference)
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
    providerId,
    thinkingEffort: getModelProviderDefaultModelOptions().llm.thinkingEffort ?? null
  }
}

function resolvePreferredModelId(modelPreference: "fast" | undefined): string {
  if (modelPreference !== "fast") {
    return getModelProviderDefaultModel("llm")
  }

  const configuredFastModelId = FAST_MODEL_CANDIDATE_IDS.find((modelId) => {
    const model = listModelCatalog().find((candidate) => candidate.id === modelId)
    return model?.modelType === "llm" && getProviderAdapter(model.provider).hasCredentials()
  })

  return configuredFastModelId ?? getModelProviderDefaultModel("llm")
}
