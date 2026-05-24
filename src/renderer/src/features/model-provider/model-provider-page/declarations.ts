import type { ModelConfig, Provider, ProviderId } from "@/types"

export type ModelProvider = {
  configurationStatus: Provider["customConfiguration"]["status"]
  credentialSchema: Provider["providerCredentialSchema"]
  label: string
  modelListError?: string
  modelListStatus: Provider["modelListStatus"]
  models: ModelConfig[]
  provider: ProviderId
  supportedModelTypes: Provider["supportedModelTypes"]
}

export const FIXED_MODEL_PROVIDER_ORDER: ProviderId[] = ["openai", "anthropic", "deepseek"]

export function toModelProvider(provider: Provider, models: ModelConfig[]): ModelProvider {
  return {
    configurationStatus: provider.customConfiguration.status,
    credentialSchema: provider.providerCredentialSchema,
    label: provider.name,
    modelListError: provider.modelListError,
    modelListStatus: provider.modelListStatus,
    models: models.filter((model) => model.provider === provider.id),
    provider: provider.id,
    supportedModelTypes: provider.supportedModelTypes
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
