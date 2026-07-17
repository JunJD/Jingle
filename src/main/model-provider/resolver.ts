import { getProviderAdapter } from "./adapters"
import {
  getModelConfig,
  getProviderDefinition,
  parseProviderModelId,
  toProviderModelId
} from "./catalog"
import { resolveModelContextLimit, resolveModelMaxOutputTokens } from "./model-limits"
import {
  getJingleModelProviderConfig,
  getModelProviderDefaultModel,
  getModelProviderDefaultRuntimeSelection
} from "./settings"
import {
  MODEL_RUNTIME_SELECTION_VERSION,
  parseModelRuntimeSelection
} from "@shared/model-runtime-selection"
import type { ModelRuntimeSelection, ResolvedModelRuntimeConfig, ThinkingEffort } from "./types"
import { getCustomProviderConfig } from "./custom-providers"
import {
  assertReasoningEffortSupported,
  resolveModelReasoningEffortCapability
} from "./reasoning-capabilities"

export type ResolveModelRuntimeConfigOptions =
  | { selection: ModelRuntimeSelection }
  | { modelPreference: "fast"; thinkingEffort: ThinkingEffort | null }

export function resolveModelRuntimeConfig(
  options: ResolveModelRuntimeConfigOptions
): ResolvedModelRuntimeConfig {
  let resolvedModelId: string
  let thinkingEffort: ThinkingEffort | null
  if ("selection" in options) {
    const selection = parseModelRuntimeSelection(options.selection)
    if (!selection) {
      throw new Error("Model runtime selection is invalid or uses an unsupported version.")
    }
    resolvedModelId = selection.modelId
    thinkingEffort = selection.thinkingEffort
  } else {
    resolvedModelId = resolvePreferredModelId(options.modelPreference)
    thinkingEffort = options.thinkingEffort
  }
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

export function resolveDefaultModelRuntimeSelection(): ModelRuntimeSelection {
  const selection = getModelProviderDefaultRuntimeSelection()
  resolveModelRuntimeConfig({ selection })
  return selection
}

export function resolveModelRuntimeSelectionFromStoredPreference(
  modelId: string
): ModelRuntimeSelection {
  const parsedModelId = parseProviderModelId(modelId)
  const providerConfig = getJingleModelProviderConfig().providers[parsedModelId.providerId]
  if (
    !providerConfig ||
    !Object.hasOwn(providerConfig, "thinkingEffort") ||
    providerConfig.thinkingEffort === undefined
  ) {
    throw new Error(
      `Model provider ${parsedModelId.providerId} has no durable reasoning effort preference. Open model settings and select the model and effort before switching this thread.`
    )
  }

  const selection = {
    modelId,
    thinkingEffort: providerConfig.thinkingEffort,
    version: MODEL_RUNTIME_SELECTION_VERSION
  }
  resolveModelRuntimeConfig({ selection })
  return selection
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
