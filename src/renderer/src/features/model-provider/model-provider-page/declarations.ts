import type { ModelConfig, Provider, ProviderId } from "@/types"

export type ModelProvider = {
  hasApiKey: boolean
  label: string
  modelError?: string
  modelStatus: Provider["modelStatus"]
  models: ModelConfig[]
  provider: ProviderId
}

export const FIXED_MODEL_PROVIDER_ORDER: ProviderId[] = ["openai", "anthropic"]

export function toModelProvider(provider: Provider, models: ModelConfig[]): ModelProvider {
  return {
    hasApiKey: provider.hasApiKey,
    label: provider.name,
    modelError: provider.modelError,
    modelStatus: provider.modelStatus,
    models: models.filter((model) => model.provider === provider.id),
    provider: provider.id
  }
}

export function sortModelProviders(providers: ModelProvider[]): ModelProvider[] {
  return [...providers].sort((a, b) => {
    const fixedProviderDiff = getFixedProviderRank(a.provider) - getFixedProviderRank(b.provider)
    if (fixedProviderDiff !== 0) {
      return fixedProviderDiff
    }

    return a.label.localeCompare(b.label)
  })
}

function getFixedProviderRank(provider: ProviderId): number {
  const fixedIndex = FIXED_MODEL_PROVIDER_ORDER.indexOf(provider)
  return fixedIndex === -1 ? FIXED_MODEL_PROVIDER_ORDER.length : fixedIndex
}
