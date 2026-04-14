import type { ModelConfig, ModelProviderState, Provider, ProviderId } from "../../shared/app-types"

export interface ProviderDefinition extends Pick<Provider, "id" | "name"> {}

export interface ResolvedModelRuntimeConfig {
  apiKey?: string
  modelId: string
  modelName: string
  options: {
    baseUrl?: string
  }
  providerId: ProviderId
}

export type { ModelConfig, ModelProviderState, Provider, ProviderId }
