import type { ModelConfig, Provider, ProviderId } from "../types"
import {
  getModelConfig,
  getProviderDefinition,
  listProviderDefinitions,
  parseProviderModelId
} from "./catalog"
import {
  listCatalogModelsByProvider,
  listRemoteModelsByProvider,
  validateRemoteProviderCredentials
} from "./model-list"
import { deleteProviderApiKey, getProviderApiKey, setProviderApiKey } from "./secrets"
import { getModelProviderDefaultModel, setModelProviderDefaultModel } from "./settings"
import type { ModelProviderState, ProviderDefinition } from "./types"

export async function getModelProviderStateForUI(): Promise<ModelProviderState> {
  const providerStates = await Promise.all(
    listProviderDefinitions().map((provider) => loadProviderStateForUI(provider))
  )

  return {
    models: providerStates.flatMap((state) => state.models),
    providers: providerStates.flatMap((state) => state.providers)
  }
}

async function loadProviderStateForUI(provider: ProviderDefinition): Promise<ModelProviderState> {
  const apiKey = getProviderApiKey(provider.id)
  if (!apiKey) {
    return {
      models: listCatalogModelsByProvider(provider.id, false),
      providers: [
        {
          id: provider.id,
          name: provider.name,
          hasApiKey: false,
          modelStatus: "not_configured"
        }
      ]
    }
  }

  try {
    const providerModels = await listRemoteModelsByProvider(provider.id, apiKey)
    return {
      models: providerModels,
      providers: [
        {
          id: provider.id,
          name: provider.name,
          hasApiKey: true,
          modelStatus: "available"
        }
      ]
    }
  } catch (error) {
    return {
      models: [],
      providers: [
        {
          id: provider.id,
          name: provider.name,
          hasApiKey: true,
          modelError: error instanceof Error ? error.message : String(error),
          modelStatus: "error"
        }
      ]
    }
  }
}

export async function listProvidersForUI(): Promise<Provider[]> {
  return (await getModelProviderStateForUI()).providers
}

export async function listModelsForUI(): Promise<ModelConfig[]> {
  return (await getModelProviderStateForUI()).models
}

export async function listModelsByProviderForUI(provider: string): Promise<ModelConfig[]> {
  const providerId = requireProviderId(provider)

  const apiKey = getProviderApiKey(providerId)
  if (!apiKey) {
    return listCatalogModelsByProvider(providerId, false)
  }

  return listRemoteModelsByProvider(providerId, apiKey)
}

export function getDefaultModelForUI(): string {
  return getModelProviderDefaultModel()
}

export async function setDefaultModelForUI(modelId: string): Promise<void> {
  const parsedModelId = parseProviderModelId(modelId)
  const apiKey = getProviderApiKey(parsedModelId.providerId)
  if (!apiKey) {
    throw new Error(`Model provider API key is not configured: ${parsedModelId.providerId}`)
  }

  const providerModels = await listRemoteModelsByProvider(parsedModelId.providerId, apiKey)
  const targetModel = providerModels.find((model) => model.id === modelId)
  if (!targetModel) {
    throw new Error(
      `Model is not available for provider ${parsedModelId.providerId}: ${parsedModelId.modelName}`
    )
  }

  setModelProviderDefaultModel(modelId)
}

export async function setProviderApiKeyForUI(provider: string, apiKey: string): Promise<void> {
  const trimmedApiKey = apiKey.trim()
  if (!trimmedApiKey) {
    throw new Error("Provider API key must not be empty")
  }

  const providerId = requireProviderId(provider)
  await validateRemoteProviderCredentials(providerId, trimmedApiKey)
  setProviderApiKey(providerId, trimmedApiKey)
}

export function deleteProviderApiKeyForUI(provider: string): void {
  deleteProviderApiKey(requireProviderId(provider))
}

export { getModelConfig }

function requireProviderId(provider: string): ProviderId {
  const providerDefinition = getProviderDefinition(provider)
  if (!providerDefinition) {
    throw new Error(`Model provider is not configured: ${provider}`)
  }

  return providerDefinition.id
}
