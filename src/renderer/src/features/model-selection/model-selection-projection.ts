import type { ProviderId } from "@/types"
import type { ModelSetupModel, ModelSetupProvider, ModelSetupSnapshot } from "@shared/model-setup"
import { getProviderReadiness } from "../model-provider/model-setup/model-setup-projection"

export type ModelSelectionLoadState = "error" | "loading" | "ready"

export type ModelSelectionProviderAvailability =
  | { kind: "ready" }
  | { kind: "configuration-required" }
  | { kind: "discovery-required" }
  | { detail: string | null; kind: "error" }

export interface ModelSelectionProviderProjection {
  availability: ModelSelectionProviderAvailability
  id: ProviderId
  name: string
}

export interface ModelSelectionModelProjection {
  id: string
  modelCode: string
  name: string
  providerId: ProviderId
  status: ModelSetupModel["status"]
}

export interface ModelSelectionCatalogProjection {
  contractIssueCount: number
  defaultModelId: string | null
  models: readonly ModelSelectionModelProjection[]
  providers: readonly ModelSelectionProviderProjection[]
}

export interface ModelSelectionContentProjection {
  effectiveProviderId: ProviderId | null
  hasSelectionIssue: boolean
  models: ReadonlyArray<ModelSelectionModelProjection & { isSelected: boolean }>
  providerResolution: ModelSelectionProviderResolution
  providers: ReadonlyArray<ModelSelectionProviderProjection & { isSelected: boolean }>
  selectedProvider: ModelSelectionProviderProjection | null
}

export type ModelSelectionProviderResolution =
  | { kind: "configured"; providerId: ProviderId }
  | {
      kind: "unavailable"
      reason: "unknown-model" | "unknown-provider"
      referenceId: string
    }
  | { kind: "none" }

export interface ModelQuickPickerRowProjection {
  id: string
  isSelected: boolean
  name: string
  providerId: ProviderId
  providerName: string
}

export interface ModelQuickPickerProjection {
  notice: ModelQuickPickerNotice
  rows: readonly ModelQuickPickerRowProjection[]
}

export type ModelQuickPickerNotice =
  | { kind: "catalog-error" }
  | {
      kind: "configuration-required"
      providerId: ProviderId
      providerName: string
    }
  | {
      kind: "discovery-required"
      providerId: ProviderId
      providerName: string
    }
  | {
      detail: string | null
      kind: "provider-error"
      providerId: ProviderId
      providerName: string
    }
  | { kind: "none" }

export type SelectedModelSummaryProjection =
  | {
      kind: "configured"
      modelId: string
      name: string
      providerId: ProviderId
    }
  | { kind: "none" }
  | {
      kind: "unavailable"
      modelId: string
      providerId?: ProviderId
      reason:
        | "inactive-model"
        | "provider-configuration-required"
        | "provider-discovery-required"
        | "provider-error"
        | "unknown-model"
        | "unknown-provider"
    }

function projectProviderAvailability(
  provider: ModelSetupProvider,
  models: ModelSetupModel[]
): ModelSelectionProviderAvailability {
  switch (getProviderReadiness(provider, models)) {
    case "ready":
      return { kind: "ready" }
    case "error":
      return {
        detail: provider.modelListError?.trim() ? provider.modelListError : null,
        kind: "error"
      }
    case "needs-setup":
      return { kind: "configuration-required" }
    case "needs-models":
      return { kind: "discovery-required" }
  }
}

export function projectModelSelectionLoadState(input: {
  error: string | null
  loading: boolean
  snapshot: ModelSetupSnapshot | null
}): ModelSelectionLoadState {
  if (input.loading) {
    return "loading"
  }
  if (input.error !== null) {
    return "error"
  }

  return input.snapshot ? "ready" : "loading"
}

export function projectModelSelectionCatalog(
  snapshot: ModelSetupSnapshot | null
): ModelSelectionCatalogProjection {
  const models = snapshot?.models ?? []
  const providers = snapshot?.providers ?? []
  const providerIds = new Set(providers.map((provider) => provider.id))
  const contractIssueCount = models.reduce(
    (count, model) => count + (providerIds.has(model.provider) ? 0 : 1),
    0
  )

  return {
    contractIssueCount,
    defaultModelId: snapshot?.defaultModel.id ?? null,
    models: models.map((model) => ({
      id: model.id,
      modelCode: model.model,
      name: model.name,
      providerId: model.provider,
      status: model.status
    })),
    providers: providers.map((provider) => ({
      availability: projectProviderAvailability(provider, models),
      id: provider.id,
      name: provider.name
    }))
  }
}

export function resolveModelSelectionModelId(
  catalog: ModelSelectionCatalogProjection,
  currentModelId: string | null
): string | null {
  return currentModelId ?? catalog.defaultModelId
}

function resolveEffectiveProvider(
  catalog: ModelSelectionCatalogProjection,
  currentModelId: string | null,
  requestedProviderId: ProviderId | null
): ModelSelectionProviderResolution {
  if (requestedProviderId !== null) {
    return catalog.providers.some((provider) => provider.id === requestedProviderId)
      ? { kind: "configured", providerId: requestedProviderId }
      : {
          kind: "unavailable",
          reason: "unknown-provider",
          referenceId: requestedProviderId
        }
  }

  const selectedModel = projectSelectedModelSummary(catalog, currentModelId)
  if (selectedModel.kind === "configured") {
    return { kind: "configured", providerId: selectedModel.providerId }
  }
  if (selectedModel.kind === "unavailable") {
    if (
      selectedModel.providerId !== undefined &&
      catalog.providers.some((provider) => provider.id === selectedModel.providerId)
    ) {
      return { kind: "configured", providerId: selectedModel.providerId }
    }
    if (selectedModel.reason === "unknown-provider" && selectedModel.providerId !== undefined) {
      return {
        kind: "unavailable",
        reason: "unknown-provider",
        referenceId: selectedModel.providerId
      }
    }

    return {
      kind: "unavailable",
      reason: "unknown-model",
      referenceId: selectedModel.modelId
    }
  }

  const firstProvider = catalog.providers[0]
  return firstProvider ? { kind: "configured", providerId: firstProvider.id } : { kind: "none" }
}

export function projectModelSelectionContent(
  catalog: ModelSelectionCatalogProjection,
  currentModelId: string | null,
  requestedProviderId: ProviderId | null
): ModelSelectionContentProjection {
  const providerResolution = resolveEffectiveProvider(catalog, currentModelId, requestedProviderId)
  const effectiveProviderId =
    providerResolution.kind === "configured" ? providerResolution.providerId : null
  const selectedProvider =
    catalog.providers.find((provider) => provider.id === effectiveProviderId) ?? null
  const selectedModel = projectSelectedModelSummary(catalog, currentModelId)

  return {
    effectiveProviderId,
    hasSelectionIssue: selectedModel.kind === "unavailable",
    models: catalog.models
      .filter((model) => model.providerId === effectiveProviderId && model.status === "active")
      .map((model) => ({ ...model, isSelected: model.id === currentModelId })),
    providerResolution,
    providers: catalog.providers.map((provider) => ({
      ...provider,
      isSelected: provider.id === effectiveProviderId
    })),
    selectedProvider
  }
}

export function projectModelQuickPicker(
  catalog: ModelSelectionCatalogProjection,
  currentModelId: string | null,
  searchQuery: string
): ModelQuickPickerProjection {
  const providerById = new Map(catalog.providers.map((provider) => [provider.id, provider]))
  const selectedModel = projectSelectedModelSummary(catalog, currentModelId)
  const selectedProviderId = selectedModel.kind === "configured" ? selectedModel.providerId : null
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const rows = catalog.models
    .reduce<
      Array<{
        index: number
        model: ModelSelectionModelProjection
        provider: ModelSelectionProviderProjection
      }>
    >((visible, model, index) => {
      const provider = providerById.get(model.providerId)
      if (!provider || model.status !== "active" || provider.availability.kind !== "ready") {
        return visible
      }

      if (normalizedSearchQuery) {
        const searchText = `${model.name} ${model.modelCode} ${provider.name}`.toLowerCase()
        if (!searchText.includes(normalizedSearchQuery)) {
          return visible
        }
      }

      visible.push({ index, model, provider })
      return visible
    }, [])
    .sort((left, right) => {
      const leftProviderRank = left.model.providerId === selectedProviderId ? 0 : 1
      const rightProviderRank = right.model.providerId === selectedProviderId ? 0 : 1

      if (leftProviderRank !== rightProviderRank) {
        return leftProviderRank - rightProviderRank
      }

      return left.index - right.index
    })
    .map(({ model, provider }) => ({
      id: model.id,
      isSelected: model.id === currentModelId,
      name: model.name,
      providerId: provider.id,
      providerName: provider.name
    }))
  const hasSelectableModels = catalog.models.some((model) => {
    const provider = providerById.get(model.providerId)
    return model.status === "active" && provider?.availability.kind === "ready"
  })

  return {
    notice: projectModelQuickPickerNotice({
      catalog,
      hasSelectableModels,
      selectedModel
    }),
    rows
  }
}

function projectModelQuickPickerNotice(input: {
  catalog: ModelSelectionCatalogProjection
  hasSelectableModels: boolean
  selectedModel: SelectedModelSummaryProjection
}): ModelQuickPickerNotice {
  const { catalog, hasSelectableModels, selectedModel } = input
  if (catalog.contractIssueCount > 0) {
    return { kind: "catalog-error" }
  }

  if (selectedModel.kind === "unavailable") {
    if (
      selectedModel.reason === "unknown-model" ||
      selectedModel.reason === "unknown-provider" ||
      selectedModel.reason === "inactive-model"
    ) {
      return { kind: "catalog-error" }
    }

    const selectedProvider = catalog.providers.find(
      (provider) => provider.id === selectedModel.providerId
    )
    return selectedProvider ? projectProviderNotice(selectedProvider) : { kind: "catalog-error" }
  }

  if (hasSelectableModels) {
    return { kind: "none" }
  }

  const unavailableProvider = catalog.providers.find(
    (provider) => provider.availability.kind !== "ready"
  )
  return unavailableProvider ? projectProviderNotice(unavailableProvider) : { kind: "none" }
}

function projectProviderNotice(provider: ModelSelectionProviderProjection): ModelQuickPickerNotice {
  switch (provider.availability.kind) {
    case "ready":
      return { kind: "none" }
    case "configuration-required":
      return {
        kind: "configuration-required",
        providerId: provider.id,
        providerName: provider.name
      }
    case "discovery-required":
      return {
        kind: "discovery-required",
        providerId: provider.id,
        providerName: provider.name
      }
    case "error":
      return {
        detail: provider.availability.detail,
        kind: "provider-error",
        providerId: provider.id,
        providerName: provider.name
      }
  }
}

export function projectSelectedModelSummary(
  catalog: ModelSelectionCatalogProjection,
  modelId: string | null
): SelectedModelSummaryProjection {
  if (modelId === null) {
    return { kind: "none" }
  }

  const model = catalog.models.find((entry) => entry.id === modelId)
  if (!model) {
    return { kind: "unavailable", modelId, reason: "unknown-model" }
  }

  const provider = catalog.providers.find((entry) => entry.id === model.providerId)
  if (!provider) {
    return {
      kind: "unavailable",
      modelId,
      providerId: model.providerId,
      reason: "unknown-provider"
    }
  }

  if (model.status !== "active") {
    return {
      kind: "unavailable",
      modelId,
      providerId: provider.id,
      reason: "inactive-model"
    }
  }

  if (provider.availability.kind !== "ready") {
    return {
      kind: "unavailable",
      modelId,
      providerId: provider.id,
      reason:
        provider.availability.kind === "configuration-required"
          ? "provider-configuration-required"
          : provider.availability.kind === "discovery-required"
            ? "provider-discovery-required"
            : "provider-error"
    }
  }

  return {
    kind: "configured",
    modelId,
    name: model.name,
    providerId: provider.id
  }
}
