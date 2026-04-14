import type { ModelConfig, ModelType, Provider } from "../types"
import type { SupportedDefaultModelType } from "../../shared/app-types"
import {
  API_KEY_CREDENTIAL_VARIABLE,
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
import { deleteProviderCredentials, getProviderApiKey, setProviderCredential } from "./secrets"
import {
  getModelProviderDefaultModel,
  getModelProviderDefaultModels,
  setModelProviderDefaultModel
} from "./settings"
import type { ModelProviderState, ProviderDefinition } from "./types"

type ProviderLoadState = Pick<ModelProviderState, "models" | "providers">

export function getModelProviderStateForUI(): ModelProviderState {
  const providerStates = listProviderDefinitions().map((provider) => loadProviderStateForUI(provider))

  return {
    defaultModels: getModelProviderDefaultModels(),
    models: providerStates.flatMap((state) => state.models),
    providers: providerStates.flatMap((state) => state.providers)
  }
}

function loadProviderStateForUI(provider: ProviderDefinition): ProviderLoadState {
  const apiKey = getProviderApiKey(provider.id)
  if (!apiKey) {
    return {
      models: listCatalogModelsByProvider(provider.id, "no-configure"),
      providers: [toProviderState(provider, "no-configure", "no-configure")]
    }
  }

  return {
    models: listCatalogModelsByProvider(provider.id, "active"),
    providers: [toProviderState(provider, "active", "active")]
  }
}

export function listModelsForUI(modelType: string = "llm"): ModelConfig[] {
  const supportedModelType = requireSupportedDefaultModelType(modelType)
  return getModelProviderStateForUI().models.filter((model) => model.modelType === supportedModelType)
}

export async function listModelsByProviderForUI(
  provider: string,
  modelType: string = "llm"
): Promise<ModelConfig[]> {
  const providerDefinition = requireProviderDefinition(provider)
  const providerId = providerDefinition.id
  const supportedModelType = requireSupportedDefaultModelType(modelType)
  requireProviderSupportsModelType(providerDefinition, supportedModelType)

  const apiKey = getProviderApiKey(providerId)
  if (!apiKey) {
    return listCatalogModelsByProvider(providerId, "no-configure").filter(
      (model) => model.modelType === supportedModelType
    )
  }

  return (await listRemoteModelsByProvider(providerId, apiKey)).filter(
    (model) => model.modelType === supportedModelType
  )
}

export function getDefaultModelForUI(modelType: string): string {
  return getModelProviderDefaultModel(requireSupportedDefaultModelType(modelType))
}

export async function setDefaultModelForUI(modelType: string, modelId: string): Promise<void> {
  const supportedModelType = requireSupportedDefaultModelType(modelType)
  const parsedModelId = parseProviderModelId(modelId)
  const providerDefinition = requireProviderDefinition(parsedModelId.providerId)
  requireProviderSupportsModelType(providerDefinition, supportedModelType)
  const apiKey = getProviderApiKey(parsedModelId.providerId)
  if (!apiKey) {
    throw new Error(`Model provider API key is not configured: ${parsedModelId.providerId}`)
  }

  const providerModels = await listRemoteModelsByProvider(parsedModelId.providerId, apiKey)
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
  const providerDefinition = requireProviderDefinition(provider)
  const trimmedApiKey = requireProviderCredential(providerDefinition, credentials)
  if (!trimmedApiKey) {
    throw new Error("Provider API key must not be empty")
  }

  await validateRemoteProviderCredentials(providerDefinition.id, trimmedApiKey)
  setProviderCredential(providerDefinition.id, API_KEY_CREDENTIAL_VARIABLE, trimmedApiKey)
}

export function deleteProviderCredentialsForUI(provider: string): void {
  const providerDefinition = requireProviderDefinition(provider)
  deleteProviderCredentials(
    providerDefinition.id,
    providerDefinition.credentialFormSchemas.map((schema) => schema.variable)
  )
}

export { getModelConfig }

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

function requireProviderCredential(
  provider: ProviderDefinition,
  credentials: Record<string, string>
): string {
  const apiKeySchema = provider.credentialFormSchemas.find(
    (schema) => schema.variable === API_KEY_CREDENTIAL_VARIABLE
  )
  if (!apiKeySchema) {
    throw new Error(`Model provider ${provider.id} does not declare an API key credential schema`)
  }

  return credentials[apiKeySchema.variable]?.trim() ?? ""
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
