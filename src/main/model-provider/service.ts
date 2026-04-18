import type { ModelConfig, ModelType, Provider, ProviderModelsResponse } from "../types"
import type { SupportedDefaultModelType } from "../../shared/app-types"
import { getProviderAdapter, listProviderAdapters } from "./adapters"
import { getModelConfig, getProviderDefinition, parseProviderModelId } from "./catalog"
import { listCatalogModelsByProvider } from "./model-list"
import {
  clearProviderModelListState,
  getProviderModelListState,
  setProviderModelListError,
  setProviderModelListSuccess
} from "./model-list-state"
import {
  getModelProviderDefaultModel,
  getModelProviderDefaultModels,
  setModelProviderDefaultModel
} from "./settings"
import type { ModelProviderState, ProviderDefinition } from "./types"

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

  setDefaultModel(modelType: string, modelId: string): Promise<void> {
    return setDefaultModelForUI(modelType, modelId)
  }

  setCredentials(provider: string, credentials: Record<string, string>): Promise<void> {
    return setProviderCredentialsForUI(provider, credentials)
  }

  deleteCredentials(provider: string): void {
    deleteProviderCredentialsForUI(provider)
  }
}

export function getModelProviderStateForUI(): ModelProviderState {
  return {
    defaultModels: getModelProviderDefaultModels(),
    providers: listProviderAdapters().map((adapter) => getProviderStateForUI(adapter))
  }
}

export function listModelsForUI(modelType: string = "llm"): ModelConfig[] {
  const supportedModelType = requireSupportedDefaultModelType(modelType)

  return listProviderAdapters().flatMap((adapter) => {
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

export async function setDefaultModelForUI(modelType: string, modelId: string): Promise<void> {
  const supportedModelType = requireSupportedDefaultModelType(modelType)
  const parsedModelId = parseProviderModelId(modelId)
  const adapter = getProviderAdapter(parsedModelId.providerId)
  requireProviderSupportsModelType(adapter.definition, supportedModelType)
  const credentials = adapter.getCredentials()
  if (!credentials) {
    throw new Error(`Model provider credentials are not configured: ${parsedModelId.providerId}`)
  }

  const providerModels = await adapter.listModels(credentials)
  setProviderModelListSuccess(parsedModelId.providerId, providerModels)
  const targetModel = providerModels.find(
    (model) => model.id === modelId && model.modelType === supportedModelType
  )
  if (!targetModel) {
    throw new Error(
      `Model is not available for provider ${parsedModelId.providerId}: ${parsedModelId.modelName}`
    )
  }

  setModelProviderDefaultModel(supportedModelType, modelId)
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
}

export function deleteProviderCredentialsForUI(provider: string): void {
  const adapter = requireProviderAdapter(provider)
  adapter.deleteCredentials()
  clearProviderModelListState(adapter.definition.id)
}

export { getModelConfig }

function getProviderStateForUI(adapter: ReturnType<typeof getProviderAdapter>): Provider {
  if (!adapter.hasCredentials()) {
    return toProviderState(adapter.definition, "no-configure", "no-configure")
  }

  const modelListState = getProviderModelListState(adapter.definition.id)
  if (modelListState?.status === "error") {
    return toProviderState(adapter.definition, "active", "error", modelListState.error)
  }

  return toProviderState(adapter.definition, "active", "active")
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
  return {
    configurateMethods: provider.configurateMethods,
    customConfiguration: {
      currentCredentialName:
        customConfigurationStatus === "active" ? `${provider.name} API Key` : undefined,
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
    supportedModelTypes: provider.supportedModelTypes,
    systemConfiguration: {
      enabled: false
    }
  }
}
