import { ipcRenderer } from "electron"
import type {
  ModelConfig,
  ModelProviderState,
  ModelType,
  ProviderId,
  ProviderModelsResponse
} from "../../shared/app-types"

export const modelsApi = {
  getState: (): Promise<ModelProviderState> => {
    return ipcRenderer.invoke("models:getState")
  },
  list: (modelType?: ModelType): Promise<ModelConfig[]> => {
    return ipcRenderer.invoke("models:list", modelType)
  },
  listByProvider: (
    provider: ProviderId,
    modelType?: ModelType
  ): Promise<ProviderModelsResponse> => {
    return ipcRenderer.invoke("models:listByProvider", provider, modelType)
  },
  getDefault: (modelType: "llm"): Promise<string> => {
    return ipcRenderer.invoke("models:getDefault", modelType)
  },
  setDefault: (modelType: "llm", modelId: string): Promise<void> => {
    return ipcRenderer.invoke("models:setDefault", { modelId, modelType })
  },
  setCredentials: (provider: ProviderId, credentials: Record<string, string>): Promise<void> => {
    return ipcRenderer.invoke("models:setCredentials", { credentials, provider })
  },
  deleteCredentials: (provider: ProviderId): Promise<void> => {
    return ipcRenderer.invoke("models:deleteCredentials", provider)
  }
}
