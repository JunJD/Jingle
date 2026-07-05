import type {
  ModelConfig,
  ModelProviderState,
  ModelProviderPaths,
  ModelType,
  ProviderId,
  CustomProviderInput,
  CustomProviderConfig,
  ProviderModelsResponse,
  SetDefaultModelOptions
} from "@shared/app-types"
import { invokeIpc } from "../ipc"

export const modelsApi = {
  getState: (): Promise<ModelProviderState> => {
    return invokeIpc("models:getState")
  },
  getPaths: (): Promise<ModelProviderPaths> => {
    return invokeIpc("models:getPaths")
  },
  list: (modelType?: ModelType): Promise<ModelConfig[]> => {
    return invokeIpc("models:list", modelType)
  },
  listByProvider: (
    provider: ProviderId,
    modelType?: ModelType
  ): Promise<ProviderModelsResponse> => {
    return invokeIpc("models:listByProvider", provider, modelType)
  },
  getDefault: (modelType: "llm"): Promise<string> => {
    return invokeIpc("models:getDefault", modelType)
  },
  setDefault: (
    modelType: "llm",
    modelId: string,
    options?: SetDefaultModelOptions
  ): Promise<void> => {
    return invokeIpc("models:setDefault", { modelId, modelType, options })
  },
  setCredentials: (provider: ProviderId, credentials: Record<string, string>): Promise<void> => {
    return invokeIpc("models:setCredentials", { credentials, provider })
  },
  getCredentials: (provider: ProviderId): Promise<Record<string, string> | null> => {
    return invokeIpc("models:getCredentials", provider)
  },
  getCustomProvider: (provider: ProviderId): Promise<CustomProviderConfig | null> => {
    return invokeIpc("models:getCustomProvider", provider)
  },
  deleteCredentials: (provider: ProviderId): Promise<void> => {
    return invokeIpc("models:deleteCredentials", provider)
  },
  upsertCustomProvider: (provider: CustomProviderInput): Promise<ProviderId> => {
    return invokeIpc("models:upsertCustomProvider", { provider })
  }
}
