import type { SetDefaultModelOptions, SupportedDefaultModelType } from "@shared/app-types"
import { getProviderAdapter, listProviderAdapters } from "./adapters"
import { getModelConfig, getProviderDefinition, parseProviderModelId } from "./catalog"
import { getCustomProviderConfig, upsertCustomProvider } from "./custom-providers"
import { modelSupportsReasoning } from "./model-metadata"
import { listCatalogModelsByProvider } from "./model-list"
import { getModelProviderPaths } from "./paths"
import {
  clearProviderModelListState,
  getProviderModelListState,
  setProviderModelListError,
  setProviderModelListSuccess
} from "./model-list-state"
import {
  getActiveProviderId,
  getJingleModelProviderConfig,
  getModelProviderDefaultModel,
  getModelProviderDefaultModelOptions,
  getModelProviderDefaultModels,
  markProviderConfigured,
  markProviderUnconfigured,
  setModelProviderDefaultModel
} from "./settings"
import type {
  CustomProviderInput,
  CustomProviderConfig,
  ModelConfig,
  ModelProviderPaths,
  ModelProviderState,
  ModelType,
  Provider,
  ProviderDefinition,
  ProviderId,
  ProviderModelsResponse
} from "./types"

export class ModelProviderService {
  getState(): ModelProviderState {
    return getModelProviderStateForUI()
  }

  listModels(modelType: string = "llm"): ModelConfig[] {
    return listModelsForUI(modelType)
  }

  listModelsByProvider(
    provider: string,
    modelType: string = "llm"
  ): Promise<ProviderModelsResponse> {
    return listModelsByProviderForUI(provider, modelType)
  }

  getDefaultModel(modelType: string): string {
    return getDefaultModelForUI(modelType)
  }

  setDefaultModel(
    modelType: string,
    modelId: string,
    options: SetDefaultModelOptions = {}
  ): Promise<void> {
    return setDefaultModelForUI(modelType, modelId, options)
  }

  setCredentials(provider: string, credentials: Record<string, string>): Promise<void> {
    return setProviderCredentialsForUI(provider, credentials)
  }

  getCredentials(provider: string): Record<string, string> | null {
    return getProviderCredentialsForUI(provider)
  }

  deleteCredentials(provider: string): void {
    deleteProviderCredentialsForUI(provider)
  }

  getPaths(): ModelProviderPaths {
    return getModelProviderPaths()
  }

  getCustomProvider(provider: string): CustomProviderConfig | null {
    return getCustomProviderForUI(provider)
  }

  upsertCustomProvider(provider: CustomProviderInput): ProviderId {
    return upsertCustomProviderForUI(provider)
  }
}

export function getModelProviderStateForUI(): ModelProviderState {
  return {
    activeProviderId: getActiveProviderId(),
    defaultModelOptions: getModelProviderDefaultModelOptions(),
    defaultModels: getModelProviderDefaultModels(),
    providers: listProviderAdapters().map((adapter) => getProviderStateForUI(adapter))
  }
}

export function listModelsForUI(modelType: string = "llm"): ModelConfig[] {
  const supportedModelType = requireSupportedDefaultModelType(modelType)

  const models = listProviderAdapters().flatMap((adapter) => {
    requireProviderSupportsModelType(adapter.definition, supportedModelType)

    if (!adapter.hasCredentials()) {
      return listCatalogModelsByProvider(adapter.definition.id, "no-configure").filter(
        (model) => model.modelType === supportedModelType
      )
    }

    const modelListState = getProviderModelListState(adapter.definition.id)
    if (modelListState) {
      return modelListState.models.filter((model) => model.modelType === supportedModelType)
    }

    return listCatalogModelsByProvider(adapter.definition.id, "active").filter(
      (model) => model.modelType === supportedModelType
    )
  })

  return includeCurrentDefaultModel(models, supportedModelType)
}

export async function listModelsByProviderForUI(
  provider: string,
  modelType: string = "llm"
): Promise<ProviderModelsResponse> {
  const supportedModelType = requireSupportedDefaultModelType(modelType)
  const adapter = requireProviderAdapter(provider)
  requireProviderSupportsModelType(adapter.definition, supportedModelType)

  const credentials = adapter.getCredentials()
  if (!credentials) {
    clearProviderModelListState(adapter.definition.id)
    return {
      models: listCatalogModelsByProvider(adapter.definition.id, "no-configure").filter(
        (model) => model.modelType === supportedModelType
      ),
      provider: toProviderState(adapter.definition, "no-configure", "no-configure")
    }
  }

  try {
    const models = (await adapter.listModels(credentials)).filter(
      (model) => model.modelType === supportedModelType
    )
    setProviderModelListSuccess(adapter.definition.id, models)

    return {
      models,
      provider: toProviderState(adapter.definition, "active", "active")
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setProviderModelListError(adapter.definition.id, message)

    return {
      models: [],
      provider: toProviderState(adapter.definition, "active", "error", message)
    }
  }
}

export function getDefaultModelForUI(modelType: string): string {
  return getModelProviderDefaultModel(requireSupportedDefaultModelType(modelType))
}

export async function setDefaultModelForUI(
  modelType: string,
  modelId: string,
  options: SetDefaultModelOptions = {}
): Promise<void> {
  const supportedModelType = requireSupportedDefaultModelType(modelType)
  const parsedModelId = parseProviderModelId(modelId)
  const adapter = getProviderAdapter(parsedModelId.providerId)
  requireProviderSupportsModelType(adapter.definition, supportedModelType)
  const credentials = adapter.getCredentials()
  if (!credentials) {
    throw new Error(`Model provider credentials are not configured: ${parsedModelId.providerId}`)
  }

  const canUseUnlisted =
    options.allowUnlisted && adapter.definition.configurateMethods.includes("customizable-model")
  let providerModels: ModelConfig[]
  try {
    providerModels = await adapter.listModels(credentials)
    setProviderModelListSuccess(parsedModelId.providerId, providerModels)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setProviderModelListError(parsedModelId.providerId, message)
    if (!canUseUnlisted) {
      throw error
    }
    providerModels = []
  }

  const targetModel = providerModels.find(
    (model) => model.id === modelId && model.modelType === supportedModelType
  )
  if (targetModel) {
    setModelProviderDefaultModel(supportedModelType, modelId, options)
    return
  }

  if (canUseUnlisted) {
    setModelProviderDefaultModel(supportedModelType, modelId, {
      ...options,
      thinkingEffort:
        options.thinkingEffort === undefined
          ? modelSupportsReasoning(parsedModelId.modelName)
            ? "high"
            : null
          : options.thinkingEffort
    })
    return
  }

  throw new Error(
    `Model is not available for provider ${parsedModelId.providerId}: ${parsedModelId.modelName}`
  )
}

export async function setProviderCredentialsForUI(
  provider: string,
  credentials: Record<string, string>
): Promise<void> {
  const adapter = requireProviderAdapter(provider)
  const normalizedCredentials = adapter.normalizeCredentials(credentials)
  const models = await adapter.listModels(normalizedCredentials)

  adapter.saveCredentials(normalizedCredentials)
  setProviderModelListSuccess(adapter.definition.id, models)
  markProviderConfigured(adapter.definition.id, models[0]?.model)
}

export function getProviderCredentialsForUI(provider: string): Record<string, string> | null {
  return requireProviderAdapter(provider).getCredentials()
}

export function deleteProviderCredentialsForUI(provider: string): void {
  const adapter = requireProviderAdapter(provider)
  adapter.deleteCredentials()
  markProviderUnconfigured(adapter.definition.id)
  clearProviderModelListState(adapter.definition.id)
}

export { getModelConfig }

export function getModelProviderPathsForUI(): ModelProviderPaths {
  return getModelProviderPaths()
}

export function getCustomProviderForUI(provider: string): CustomProviderConfig | null {
  return getCustomProviderConfig(provider)
}

export function upsertCustomProviderForUI(provider: CustomProviderInput): ProviderId {
  const customProvider = upsertCustomProvider(provider)
  if (customProvider.requires_auth === false || provider.apiKey?.trim()) {
    markProviderConfigured(customProvider.name, customProvider.models[0]?.name)
  }
  return customProvider.name
}

function getProviderStateForUI(adapter: ReturnType<typeof getProviderAdapter>): Provider {
  if (!isProviderConfiguredForUI(adapter)) {
    return toProviderState(adapter.definition, "no-configure", "no-configure")
  }

  const modelListState = getProviderModelListState(adapter.definition.id)
  if (modelListState?.status === "error") {
    return toProviderState(adapter.definition, "active", "error", modelListState.error)
  }
  if (!modelListState && requiresRemoteModelDiscovery(adapter.definition)) {
    return toProviderState(adapter.definition, "active", "no-configure")
  }

  return toProviderState(adapter.definition, "active", "active")
}

function requiresRemoteModelDiscovery(provider: ProviderDefinition): boolean {
  return (
    provider.configurateMethods.includes("fetch-from-remote") &&
    listCatalogModelsByProvider(provider.id, "active").length === 0
  )
}

function includeCurrentDefaultModel(
  models: ModelConfig[],
  modelType: SupportedDefaultModelType
): ModelConfig[] {
  const defaultModelId = getModelProviderDefaultModel(modelType)
  if (models.some((model) => model.id === defaultModelId)) {
    return models
  }

  const defaultModel = resolveDefaultModelConfig(defaultModelId, modelType)
  return [...models, defaultModel]
}

function resolveDefaultModelConfig(
  modelId: string,
  modelType: SupportedDefaultModelType
): ModelConfig {
  const catalogModel = getModelConfig(modelId)
  if (catalogModel) {
    return {
      ...catalogModel,
      status: "active"
    }
  }

  const parsedModelId = parseProviderModelId(modelId)
  const provider = requireProviderDefinition(parsedModelId.providerId)
  requireProviderSupportsModelType(provider, modelType)

  return {
    fetchFrom: getSelectedModelFetchFrom(provider),
    id: modelId,
    model: parsedModelId.modelName,
    modelType,
    name: parsedModelId.modelName,
    provider: parsedModelId.providerId,
    reasoning: modelSupportsReasoning(parsedModelId.modelName),
    status: "active"
  }
}

function getSelectedModelFetchFrom(provider: ProviderDefinition): ModelConfig["fetchFrom"] {
  if (provider.configurateMethods.includes("customizable-model")) {
    return "customizable-model"
  }
  if (provider.configurateMethods.includes("fetch-from-remote")) {
    return "fetch-from-remote"
  }

  return "predefined-model"
}

function isProviderConfiguredForUI(adapter: ReturnType<typeof getProviderAdapter>): boolean {
  if (adapter.definition.credentialFormSchemas.length > 0) {
    return adapter.hasCredentials()
  }

  return getJingleModelProviderConfig().providers[adapter.definition.id]?.configured === true
}

function requireProviderAdapter(provider: string) {
  const providerDefinition = requireProviderDefinition(provider)
  return getProviderAdapter(providerDefinition.id)
}

function requireProviderDefinition(provider: string): ProviderDefinition {
  const providerDefinition = getProviderDefinition(provider)
  if (!providerDefinition) {
    throw new Error(`Model provider is not configured: ${provider}`)
  }

  return providerDefinition
}

function requireSupportedDefaultModelType(modelType: string): SupportedDefaultModelType {
  if (modelType !== "llm") {
    throw new Error(`Model type is not supported: ${modelType}`)
  }

  return modelType
}

function requireProviderSupportsModelType(
  provider: ProviderDefinition,
  modelType: ModelType
): void {
  if (!provider.supportedModelTypes.includes(modelType)) {
    throw new Error(`Model provider ${provider.id} does not support model type: ${modelType}`)
  }
}

function toProviderState(
  provider: ProviderDefinition,
  customConfigurationStatus: Provider["customConfiguration"]["status"],
  modelListStatus: Provider["modelListStatus"],
  modelListError?: string
): Provider {
  const catalogOnlyMessage =
    provider.source === "registry"
      ? "Jingle can read this model registry, but local inference runtime is not wired yet."
      : undefined

  return {
    configurateMethods: provider.configurateMethods,
    customConfiguration: {
      currentCredentialName:
        customConfigurationStatus === "active" ? `${provider.name} API Key` : undefined,
      message: catalogOnlyMessage,
      status: customConfigurationStatus
    },
    description: provider.description,
    id: provider.id,
    label: provider.label,
    modelListError,
    modelListStatus,
    name: provider.name,
    providerCredentialSchema: {
      credentialFormSchemas: provider.credentialFormSchemas
    },
    source: provider.source,
    supportedModelTypes: provider.supportedModelTypes,
    systemConfiguration: {
      enabled: false
    }
  }
}
