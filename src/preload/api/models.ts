import type {
  ModelConfig,
  ModelProviderState,
  ModelType,
  ProviderId,
  ProviderModelsResponse
} from "@shared/app-types"
import { invokeIpc } from "../ipc"

export const modelsApi = {
  getState: (): Promise<ModelProviderState> => {
    return invokeIpc("models:getState")
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
  setDefault: (modelType: "llm", modelId: string): Promise<void> => {
    return invokeIpc("models:setDefault", { modelId, modelType })
  },
  setCredentials: (provider: ProviderId, credentials: Record<string, string>): Promise<void> => {
    return invokeIpc("models:setCredentials", { credentials, provider })
  },
  getCredentials: (provider: ProviderId): Promise<Record<string, string> | null> => {
    return invokeIpc("models:getCredentials", provider)
  },
  deleteCredentials: (provider: ProviderId): Promise<void> => {
    return invokeIpc("models:deleteCredentials", provider)
  }
}
