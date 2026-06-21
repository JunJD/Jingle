import type {
  ConfigurationMethod,
  CredentialFormSchema,
  CustomProviderConfig,
  CustomProviderEngine,
  CustomProviderInput,
  DefaultModelOptions,
  DefaultModels,
  ModelConfig,
  ModelProviderState,
  ModelProviderPaths,
  ModelType,
  Provider,
  ProviderModelsResponse,
  ProviderId,
  SetDefaultModelOptions,
  SupportedDefaultModelType,
  ThinkingEffort
} from "@shared/app-types"

export interface ProviderDefinition {
  configurateMethods: ConfigurationMethod[]
  credentialFormSchemas: CredentialFormSchema[]
  description?: Provider["description"]
  fastModel?: string
  id: ProviderId
  label: Provider["label"]
  name: string
  source?: Provider["source"]
  supportedModelTypes: ModelType[]
}

export type ProviderCredentials = Record<string, string>

export interface ResolvedModelRuntimeConfig {
  contextLimit?: number
  credentials: ProviderCredentials
  maxOutputTokens?: number
  modelId: string
  modelName: string
  modelType: ModelType
  providerId: ProviderId
  thinkingEffort?: ThinkingEffort | null
}

export type {
  DefaultModelOptions,
  DefaultModels,
  CustomProviderConfig,
  CustomProviderEngine,
  CustomProviderInput,
  ModelConfig,
  ModelProviderState,
  ModelProviderPaths,
  ModelType,
  Provider,
  ProviderModelsResponse,
  ProviderId,
  SetDefaultModelOptions,
  ThinkingEffort,
  SupportedDefaultModelType
}
