import type { ProviderId } from "@shared/app-types"
import { resolveLocalizedText } from "@shared/i18n"
import type { ModelSetupModel, ModelSetupProvider, ModelSetupSnapshot } from "@shared/model-setup"

export type ModelSetupVariant = "onboarding" | "settings"

export interface ModelSetupProjection {
  currentModel: ModelSetupModel
  currentProvider: ModelSetupProvider
  freeProviders: ModelSetupProvider[]
  visibleProviders: ModelSetupProvider[]
}

export function projectModelSetupSnapshot(input: {
  query: string
  snapshot: ModelSetupSnapshot
  variant: ModelSetupVariant
}): ModelSetupProjection {
  const { query, snapshot, variant } = input
  const currentProvider = requireProvider(snapshot.providers, snapshot.defaultModel.provider)
  const freeProviders = snapshot.providers.filter(isFreeProvider)
  const providerPageProviders =
    variant === "settings"
      ? snapshot.providers
      : snapshot.providers.filter((provider) => !isFreeProvider(provider))
  const normalizedQuery = query.trim().toLowerCase()
  const visibleProviders = providerPageProviders
    .filter(
      (provider) =>
        !normalizedQuery || getProviderSearchText(provider).toLowerCase().includes(normalizedQuery)
    )
    .toSorted((left, right) => left.name.localeCompare(right.name))

  return {
    currentModel: snapshot.defaultModel,
    currentProvider,
    freeProviders,
    visibleProviders
  }
}

export function getProviderDescription(provider: ModelSetupProvider): string {
  const description = resolveLocalizedText(provider.description, "zh-CN")
  if (!description) {
    throw new Error(`Provider description is missing from the setup snapshot: ${provider.id}`)
  }

  return description
}

export function getProviderSearchText(provider: ModelSetupProvider): string {
  return [provider.name, provider.description.zh_Hans, provider.description.en_US].join(" ")
}

export type ProviderReadiness = "ready" | "error" | "needs-models" | "needs-setup"

export function getProviderReadiness(
  provider: ModelSetupProvider,
  models: ModelSetupModel[]
): ProviderReadiness {
  if (provider.customConfiguration.status !== "active") {
    return "needs-setup"
  }
  if (provider.modelListStatus === "error") {
    return "error"
  }
  if (
    provider.modelListStatus !== "active" ||
    models.every((model) => model.provider !== provider.id || model.status !== "active")
  ) {
    return "needs-models"
  }

  return "ready"
}

function isFreeProvider(provider: ModelSetupProvider): boolean {
  return provider.id === "codex" || provider.id === "local" || provider.source === "registry"
}

function requireProvider(
  providers: ModelSetupProvider[],
  providerId: ProviderId
): ModelSetupProvider {
  const provider = providers.find((candidate) => candidate.id === providerId)
  if (!provider) {
    throw new Error(`Default model provider is missing from the setup snapshot: ${providerId}`)
  }

  return provider
}
