import type {
  ConfigurationMethod,
  CredentialFormSchema,
  DefaultModels,
  ModelConfig,
  ModelProviderState,
  ModelType,
  Provider,
  ProviderModelsResponse,
  ProviderId
} from "../../shared/app-types"

export interface ProviderDefinition {
  configurateMethods: ConfigurationMethod[]
  credentialFormSchemas: CredentialFormSchema[]
  description?: Provider["description"]
  id: ProviderId
  label: Provider["label"]
  name: string
  supportedModelTypes: ModelType[]
}

export type ProviderCredentials = Record<string, string>

export interface ResolvedModelRuntimeConfig {
  credentials: ProviderCredentials
  modelId: string
  modelName: string
  modelType: ModelType
  providerId: ProviderId
}

export type {
  DefaultModels,
  ModelConfig,
  ModelProviderState,
  ModelType,
  Provider,
  ProviderModelsResponse,
  ProviderId
}
