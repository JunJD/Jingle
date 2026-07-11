import type {
  LocalizedText,
  ModelConfig,
  ModelProviderPaths,
  ModelSelectionOptions,
  Provider,
  ProviderId,
  ThinkingEffort
} from "./app-types"

export interface ModelSetupReasoningInference {
  source: "model-name-pattern"
  suggestsSupport: boolean
}

export type ModelSetupReasoningCapability =
  | {
      kind: "resolved"
      supported: boolean
    }
  | ({ kind: "inferred" } & ModelSetupReasoningInference)

export type ModelSetupModel = Omit<ModelConfig, "reasoning"> & {
  reasoningCapability: ModelSetupReasoningCapability
}

export type ModelSetupProvider = Omit<Provider, "description"> & {
  description: LocalizedText
}

export interface ModelSetupSnapshot {
  activeProviderId: ProviderId | null
  defaultModel: ModelSetupModel
  defaultModelOptions: ModelSelectionOptions
  modelProviderPaths: ModelProviderPaths
  models: ModelSetupModel[]
  providers: ModelSetupProvider[]
}

export interface ModelSetupProviderModelsResult {
  modelIds: string[]
  providerId: ProviderId
  snapshot: ModelSetupSnapshot
}

export interface ModelSetupUnlistedModelMetadata {
  modelName: string
  providerId: ProviderId
  reasoningInference: ModelSetupReasoningInference
}

export type ModelSetupModelSelection =
  | {
      kind: "listed"
      modelId: string
      thinkingEffort: ThinkingEffort | null
    }
  | {
      kind: "unlisted"
      modelName: string
      providerId: ProviderId
      thinkingEffort: ThinkingEffort | null
    }

export const MODEL_SETUP_IPC_CHANNELS = {
  activateProvider: "models:activateSetupProvider",
  getSnapshot: "models:getSetupSnapshot",
  listProviderModels: "models:listSetupProviderModels",
  resolveUnlistedModel: "models:resolveSetupUnlistedModel",
  selectModel: "models:selectSetupModel"
} as const satisfies Record<string, ModelSetupIpcChannel>

export interface ModelSetupIpcContract {
  "models:activateSetupProvider": {
    args: [providerId: ProviderId]
    result: void
  }
  "models:getSetupSnapshot": {
    args: []
    result: ModelSetupSnapshot
  }
  "models:listSetupProviderModels": {
    args: [providerId: ProviderId]
    result: ModelSetupProviderModelsResult
  }
  "models:resolveSetupUnlistedModel": {
    args: [providerId: ProviderId, modelName: string]
    result: ModelSetupUnlistedModelMetadata
  }
  "models:selectSetupModel": {
    args: [selection: ModelSetupModelSelection]
    result: void
  }
}

export type ModelSetupIpcChannel = keyof ModelSetupIpcContract
export type ModelSetupIpcArgs<TChannel extends ModelSetupIpcChannel> =
  ModelSetupIpcContract[TChannel]["args"]
export type ModelSetupIpcResult<TChannel extends ModelSetupIpcChannel> =
  ModelSetupIpcContract[TChannel]["result"]
