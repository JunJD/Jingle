import type {
  CustomProviderConfig,
  ModelConfig,
  ModelReasoningEffortCapability,
  ProviderId,
  ThinkingEffort
} from "./types"

export const REASONING_CAPABILITY_REGISTRY_VERSION = "2026-07-17"

export type ReasoningEffortTransport =
  | "anthropic-legacy-budget"
  | "deepseek-v4"
  | "google-existing"
  | "openai-compatible"
  | "openai-native"

interface RegistryEntry {
  allowedValues: ThinkingEffort[]
  reference: string
  transport: ReasoningEffortTransport
}

const OPENAI_GPT_5_1 = ["off", "low", "medium", "high"] satisfies ThinkingEffort[]
const OPENAI_GPT_5_2 = [...OPENAI_GPT_5_1, "xhigh"] satisfies ThinkingEffort[]
const OPENAI_GPT_5_6 = [...OPENAI_GPT_5_2, "max"] satisfies ThinkingEffort[]

// Exact model ids only. Provider list responses are intentionally not trusted as
// capability metadata; new aliases and snapshots require a registry update.
const BUILTIN_REGISTRY = new Map<string, RegistryEntry>([
  ...entries(
    "openai",
    ["gpt-5"],
    ["low", "medium", "high"],
    "openai-native",
    "https://developers.openai.com/api/docs/models/gpt-5"
  ),
  ...entries(
    "openai",
    ["gpt-5.1"],
    OPENAI_GPT_5_1,
    "openai-native",
    "https://developers.openai.com/api/docs/models/gpt-5.1"
  ),
  ...entries(
    "openai",
    ["gpt-5.2"],
    OPENAI_GPT_5_2,
    "openai-native",
    "https://developers.openai.com/api/docs/models/gpt-5.2"
  ),
  ...entries(
    "openai",
    ["gpt-5.4"],
    OPENAI_GPT_5_2,
    "openai-native",
    "https://developers.openai.com/api/docs/models/gpt-5.4"
  ),
  ...entries(
    "openai",
    ["gpt-5.5"],
    OPENAI_GPT_5_2,
    "openai-native",
    "https://developers.openai.com/api/docs/models/gpt-5.5"
  ),
  ...entries(
    "openai",
    ["gpt-5.6"],
    OPENAI_GPT_5_6,
    "openai-native",
    "https://developers.openai.com/api/docs/models/gpt-5.6"
  ),
  ...entries(
    "openai",
    ["gpt-5.6-sol"],
    OPENAI_GPT_5_6,
    "openai-native",
    "https://developers.openai.com/api/docs/models/gpt-5.6-sol"
  ),
  ...entries(
    "openai",
    ["gpt-5.6-terra"],
    OPENAI_GPT_5_6,
    "openai-native",
    "https://developers.openai.com/api/docs/models/gpt-5.6-terra"
  ),
  ...entries(
    "openai",
    ["gpt-5.6-luna"],
    OPENAI_GPT_5_6,
    "openai-native",
    "https://developers.openai.com/api/docs/models/gpt-5.6-luna"
  ),
  ...entries(
    "openai",
    ["o1", "o3", "o3-mini", "o4-mini"],
    ["low", "medium", "high"],
    "openai-native",
    "https://developers.openai.com/api/docs/guides/reasoning"
  ),
  ...entries(
    "deepseek",
    ["deepseek-v4-pro", "deepseek-v4-flash"],
    ["off", "high", "max"],
    "deepseek-v4",
    "https://api-docs.deepseek.com/guides/thinking_mode/"
  ),
  ...entries(
    "vercel_ai_gateway",
    ["xai/grok-4.5"],
    ["low", "medium", "high"],
    "openai-compatible",
    "https://docs.x.ai/developers/model-capabilities/text/reasoning"
  ),
  ...entries(
    "vercel_ai_gateway",
    ["xai/grok-4.20-multi-agent"],
    ["low", "medium", "high", "xhigh"],
    "openai-compatible",
    "https://docs.x.ai/developers/model-capabilities/text/reasoning"
  )
])

function entries(
  providerId: ProviderId,
  modelNames: string[],
  allowedValues: ThinkingEffort[],
  transport: ReasoningEffortTransport,
  reference: string
): Array<[string, RegistryEntry]> {
  return modelNames.map((modelName) => [
    `${providerId}:${modelName}`,
    { allowedValues: [...allowedValues], reference, transport }
  ])
}

export interface ResolvedReasoningEffortCapability {
  capability: ModelReasoningEffortCapability | null
  reference: string | null
  transport: ReasoningEffortTransport | null
}

export function createCustomReasoningEffortCapability(input: {
  model: CustomProviderConfig["models"][number]
  provider: Pick<CustomProviderConfig, "engine" | "name">
}): ModelReasoningEffortCapability | undefined {
  if (!input.model.reasoning_efforts) {
    return undefined
  }
  if (input.provider.engine !== "openai") {
    throw new Error(
      `Custom provider ${input.provider.name} declares reasoning_efforts but is not OpenAI-compatible.`
    )
  }
  return {
    allowedValues: [...input.model.reasoning_efforts],
    source: "custom-declaration",
    version: REASONING_CAPABILITY_REGISTRY_VERSION
  }
}

export function resolveModelReasoningEffortCapability(input: {
  customProvider?: CustomProviderConfig | null
  model: Pick<ModelConfig, "model" | "provider" | "reasoning" | "reasoningEffortCapability">
}): ResolvedReasoningEffortCapability {
  if (input.customProvider?.name === input.model.provider) {
    const matchingModels = input.customProvider.models.filter(
      (candidate) => candidate.name === input.model.model
    )
    if (matchingModels.length !== 1) {
      return { capability: null, reference: null, transport: null }
    }
    const declared = createCustomReasoningEffortCapability({
      model: matchingModels[0],
      provider: input.customProvider
    })
    if (!declared) {
      return { capability: null, reference: null, transport: null }
    }
    return {
      capability: declared,
      reference: "custom provider model declaration",
      transport: "openai-compatible"
    }
  }

  const registryEntry = BUILTIN_REGISTRY.get(`${input.model.provider}:${input.model.model}`)
  if (registryEntry) {
    return {
      capability: {
        allowedValues: [...registryEntry.allowedValues],
        source: "builtin-registry",
        version: REASONING_CAPABILITY_REGISTRY_VERSION
      },
      reference: registryEntry.reference,
      transport: registryEntry.transport
    }
  }

  // C1: preserve existing Anthropic/Google behavior without declaring their
  // transport to be covered by the new registry.
  if (input.model.reasoning === true && input.model.provider === "anthropic") {
    return {
      capability: {
        allowedValues: ["off", "low", "medium", "high", "max"],
        source: "legacy-provider",
        version: "anthropic-legacy-budget-v1"
      },
      reference: "existing Jingle Anthropic budget mapping",
      transport: "anthropic-legacy-budget"
    }
  }
  if (input.model.reasoning === true && input.model.provider === "google") {
    return {
      capability: null,
      reference: "existing Jingle Google behavior",
      transport: "google-existing"
    }
  }

  return { capability: null, reference: null, transport: null }
}

export function assertReasoningEffortSupported(input: {
  capability: ResolvedReasoningEffortCapability
  effort: ThinkingEffort | null | undefined
  modelId: string
}): void {
  if (input.effort === null || input.effort === undefined) {
    return
  }
  if (input.capability.transport === "google-existing" && input.effort !== "xhigh") {
    return
  }
  if (!input.capability.capability?.allowedValues.includes(input.effort)) {
    throw new Error(
      `Thinking effort "${input.effort}" is not supported by ${input.modelId}. Open model settings and choose a supported value.`
    )
  }
}
