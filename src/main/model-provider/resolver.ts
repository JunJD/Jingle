import { getProviderAdapter } from "./adapters"
import {
  getModelConfig,
  getProviderDefinition,
  parseProviderModelId,
  toProviderModelId
} from "./catalog"
import { resolveModelContextLimit, resolveModelMaxOutputTokens } from "./model-limits"
import { getModelProviderDefaultModel, getModelProviderDefaultModelOptions } from "./settings"
import type { ResolvedModelRuntimeConfig, ThinkingEffort } from "./types"
import { getCustomProviderConfig } from "./custom-providers"
import {
  assertReasoningEffortSupported,
  resolveModelReasoningEffortCapability
} from "./reasoning-capabilities"

export interface ResolveModelRuntimeConfigOptions {
  modelPreference?: "fast"
  modelId?: string
  thinkingEffort?: ThinkingEffort | null
}

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

  const modelName = configuredModel?.model ?? parsedModelId.modelName
  const thinkingEffort =
    options.thinkingEffort === undefined
      ? (getModelProviderDefaultModelOptions().llm.thinkingEffort ?? null)
      : options.thinkingEffort
  const reasoningCapability = resolveModelReasoningEffortCapability({
    customProvider: getCustomProviderConfig(providerId),
    model: configuredModel ?? {
      model: modelName,
      provider: providerId,
      reasoning: false
    }
  })
  assertReasoningEffortSupported({
    capability: reasoningCapability,
    effort: thinkingEffort,
    modelId: resolvedModelId
  })

  return {
    contextLimit: resolveModelContextLimit(configuredModel),
    credentials,
    maxOutputTokens: resolveModelMaxOutputTokens(configuredModel),
    modelId: resolvedModelId,
    modelName,
    modelType,
    providerId,
    reasoningEffortTransport: reasoningCapability.transport,
    thinkingEffort
  }
}

function resolvePreferredModelId(modelPreference: "fast" | undefined): string {
  const defaultModelId = getModelProviderDefaultModel("llm")

  if (modelPreference !== "fast") {
    return defaultModelId
  }

  const parsedDefaultModel = parseProviderModelId(defaultModelId)
  const provider = getProviderDefinition(parsedDefaultModel.providerId)
  const fastModel = provider?.fastModel?.trim()
  if (!fastModel) {
    throw new Error(
      `Model provider ${parsedDefaultModel.providerId} does not declare a fast model.`
    )
  }

  return toProviderModelId(parsedDefaultModel.providerId, fastModel)
}
