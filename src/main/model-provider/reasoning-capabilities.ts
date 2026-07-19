import type {
  CustomProviderConfig,
  ModelConfig,
  ModelReasoningEffortCapability,
  ProviderId,
  ThinkingEffort
} from "./types"

export const REASONING_CAPABILITY_REGISTRY_VERSION = "2026-07-19"
export const CUSTOM_REASONING_EFFORT_DECLARATION_VERSION = "v1"

export type ReasoningEffortTransport =
  | "anthropic-legacy-budget"
  | "deepseek-v4"
  | "google-thinking-level"
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
const ANTHROPIC_MANUAL_BUDGET = ["off", "low", "medium", "high", "max"] satisfies ThinkingEffort[]
const ANTHROPIC_OPUS_4_1_MANUAL_BUDGET = ["off", "low", "medium", "high"] satisfies ThinkingEffort[]
const REASONING_EFFORT_ORDER = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
] satisfies ThinkingEffort[]

// Exact model ids only. Provider list responses are intentionally not trusted as
// capability metadata; new aliases and snapshots require a registry update.
const BUILTIN_REGISTRY = new Map<string, RegistryEntry>([
  ...entries(
    "anthropic",
    [
      "claude-opus-4-5-20251101",
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-20250514"
    ],
    ANTHROPIC_MANUAL_BUDGET,
    "anthropic-legacy-budget",
    "https://platform.claude.com/docs/en/build-with-claude/extended-thinking"
  ),
  ...entries(
    "anthropic",
    ["claude-opus-4-1-20250805"],
    ANTHROPIC_OPUS_4_1_MANUAL_BUDGET,
    "anthropic-legacy-budget",
    "https://platform.claude.com/docs/en/build-with-claude/extended-thinking"
  ),
  ...entries(
    "openai",
    ["gpt-5", "gpt-5-2025-08-07"],
    ["minimal", "low", "medium", "high"],
    "openai-native",
    "https://developers.openai.com/api/docs/models/gpt-5"
  ),
  ...entries(
    "openai",
    ["gpt-5.1", "gpt-5.1-2025-11-13"],
    OPENAI_GPT_5_1,
    "openai-native",
    "https://developers.openai.com/api/docs/models/gpt-5.1"
  ),
  ...entries(
    "openai",
    ["gpt-5.2", "gpt-5.2-2025-12-11"],
    OPENAI_GPT_5_2,
    "openai-native",
    "https://developers.openai.com/api/docs/models/gpt-5.2"
  ),
  ...entries(
    "openai",
    ["gpt-5.4", "gpt-5.4-2026-03-05"],
    OPENAI_GPT_5_2,
    "openai-native",
    "https://developers.openai.com/api/docs/models/gpt-5.4"
  ),
  ...entries(
    "openai",
    ["gpt-5.5", "gpt-5.5-2026-04-23"],
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
    [
      "o1",
      "o1-2024-12-17",
      "o3",
      "o3-2025-04-16",
      "o3-mini",
      "o3-mini-2025-01-31",
      "o4-mini",
      "o4-mini-2025-04-16"
    ],
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
    "google",
    ["gemini-3-flash-preview"],
    ["minimal", "low", "medium", "high"],
    "google-thinking-level",
    "https://ai.google.dev/gemini-api/docs/generate-content/thinking"
  ),
  ...entries(
    "google",
    ["gemini-3.1-pro-preview"],
    ["low", "medium", "high"],
    "google-thinking-level",
    "https://ai.google.dev/gemini-api/docs/generate-content/thinking"
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

export function resolveHighestReasoningEffort(
  capability: ModelReasoningEffortCapability | null
): ThinkingEffort | null {
  return (
    REASONING_EFFORT_ORDER.findLast((effort) => capability?.allowedValues.includes(effort)) ?? null
  )
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
    version: CUSTOM_REASONING_EFFORT_DECLARATION_VERSION
  }
}

export function resolveModelReasoningEffortCapability(input: {
  customProvider?: CustomProviderConfig | null
  model: Pick<ModelConfig, "model" | "provider" | "reasoning">
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

  // Provider list metadata is not an admission fact. Models not listed above
  // stay closed until an exact transport capability is registered.
  if (input.model.reasoning === true && input.model.provider === "google") {
    return {
      capability: null,
      reference: "existing Jingle Google behavior",
      transport: null
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
  if (!input.capability.capability?.allowedValues.includes(input.effort)) {
    throw new Error(
      `Thinking effort "${input.effort}" is not supported by ${input.modelId}. Open model settings and choose a supported value.`
    )
  }
}
