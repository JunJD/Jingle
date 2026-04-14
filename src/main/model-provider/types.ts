import type {
  ConfigurationMethod,
  CredentialFormSchema,
  DefaultModels,
  ModelConfig,
  ModelProviderState,
  ModelType,
  Provider,
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

export interface ResolvedModelRuntimeConfig {
  apiKey?: string
  modelId: string
  modelName: string
  modelType: ModelType
  options: {
    baseUrl?: string
  }
  providerId: ProviderId
}

export type { DefaultModels, ModelConfig, ModelProviderState, ModelType, Provider, ProviderId }
