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
import {
  MODEL_SETUP_IPC_CHANNELS,
  type ModelSetupIpcArgs,
  type ModelSetupIpcChannel,
  type ModelSetupIpcResult,
  type ModelSetupModelSelection
} from "@shared/model-setup"
import { invokeIpc } from "../ipc"

function invokeModelSetupIpc<TChannel extends ModelSetupIpcChannel>(
  channel: TChannel,
  ...args: ModelSetupIpcArgs<TChannel>
): Promise<ModelSetupIpcResult<TChannel>> {
  return invokeIpc(channel, ...args)
}

export const modelsApi = {
  getSetupSnapshot: () => {
    return invokeModelSetupIpc(MODEL_SETUP_IPC_CHANNELS.getSnapshot)
  },
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
  },
  listSetupProviderModels: (provider: ProviderId) => {
    return invokeModelSetupIpc(MODEL_SETUP_IPC_CHANNELS.listProviderModels, provider)
  },
  activateSetupProvider: (provider: ProviderId) => {
    return invokeModelSetupIpc(MODEL_SETUP_IPC_CHANNELS.activateProvider, provider)
  },
  selectSetupModel: (selection: ModelSetupModelSelection) => {
    return invokeModelSetupIpc(MODEL_SETUP_IPC_CHANNELS.selectModel, selection)
  },
  resolveSetupUnlistedModel: (provider: ProviderId, modelName: string) => {
    return invokeModelSetupIpc(MODEL_SETUP_IPC_CHANNELS.resolveUnlistedModel, provider, modelName)
  }
}
