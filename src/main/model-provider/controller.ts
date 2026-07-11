import type { IpcMain, IpcMainInvokeEvent } from "electron"
import type { ZodType } from "zod/v4"
import {
  MODEL_SETUP_IPC_CHANNELS,
  type ModelSetupIpcArgs,
  type ModelSetupIpcChannel,
  type ModelSetupIpcResult
} from "@shared/model-setup"
import { registerIpcHandle, registerValidatedIpcHandle } from "../ipc/handle"
import { legacyModelMutationIpcArgsSchemas, modelSetupIpcArgsSchemas } from "./controller-schema"
import { ModelProviderService } from "./service"

export class ModelProviderController {
  constructor(private readonly modelProviderService: ModelProviderService) {}

  register(ipcMain: IpcMain): void {
    registerModelSetupIpcHandle(ipcMain, MODEL_SETUP_IPC_CHANNELS.getSnapshot, async () => {
      return this.modelProviderService.getSetupSnapshot()
    })

    registerIpcHandle(ipcMain, "models:list", async (_event, modelType: string = "llm") => {
      return this.modelProviderService.listModels(modelType)
    })

    registerIpcHandle(
      ipcMain,
      "models:listByProvider",
      async (_event, provider: string, modelType: string = "llm") => {
        return this.modelProviderService.listModelsByProvider(provider, modelType)
      }
    )

    registerIpcHandle(ipcMain, "models:getState", async () => {
      return this.modelProviderService.getState()
    })

    registerIpcHandle(ipcMain, "models:getPaths", async () => {
      return this.modelProviderService.getPaths()
    })

    registerIpcHandle(ipcMain, "models:getCustomProvider", async (_event, provider: string) => {
      return this.modelProviderService.getCustomProvider(provider)
    })

    registerIpcHandle(ipcMain, "models:getDefault", async (_event, modelType: string) => {
      return this.modelProviderService.getDefaultModel(modelType)
    })

    registerValidatedIpcHandle(
      ipcMain,
      "models:setDefault",
      legacyModelMutationIpcArgsSchemas.setDefault,
      async (_event, { modelType, modelId, options }) => {
        await this.modelProviderService.setDefaultModel(modelType, modelId, options)
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "models:setCredentials",
      legacyModelMutationIpcArgsSchemas.setCredentials,
      async (_event, { provider, credentials }) => {
        await this.modelProviderService.setCredentials(provider, credentials)
      }
    )

    registerIpcHandle(ipcMain, "models:getCredentials", async (_event, provider: string) => {
      return this.modelProviderService.getCredentials(provider)
    })

    registerValidatedIpcHandle(
      ipcMain,
      "models:deleteCredentials",
      legacyModelMutationIpcArgsSchemas.deleteCredentials,
      async (_event, provider) => {
        this.modelProviderService.deleteCredentials(provider)
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "models:upsertCustomProvider",
      legacyModelMutationIpcArgsSchemas.upsertCustomProvider,
      async (_event, { provider }) => {
        return this.modelProviderService.upsertCustomProvider(provider)
      }
    )

    registerModelSetupIpcHandle(
      ipcMain,
      MODEL_SETUP_IPC_CHANNELS.listProviderModels,
      async (_event, provider) => {
        return this.modelProviderService.listSetupProviderModels(provider)
      }
    )

    registerModelSetupIpcHandle(
      ipcMain,
      MODEL_SETUP_IPC_CHANNELS.activateProvider,
      async (_event, provider) => {
        return this.modelProviderService.activateSetupProvider(provider)
      }
    )

    registerModelSetupIpcHandle(
      ipcMain,
      MODEL_SETUP_IPC_CHANNELS.selectModel,
      async (_event, selection) => {
        return this.modelProviderService.selectSetupModel(selection)
      }
    )

    registerModelSetupIpcHandle(
      ipcMain,
      MODEL_SETUP_IPC_CHANNELS.resolveUnlistedModel,
      async (_event, provider, modelName) => {
        return this.modelProviderService.resolveSetupUnlistedModel(provider, modelName)
      }
    )
  }
}

function registerModelSetupIpcHandle<TChannel extends ModelSetupIpcChannel>(
  ipcMain: IpcMain,
  channel: TChannel,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: ModelSetupIpcArgs<TChannel>
  ) => Promise<ModelSetupIpcResult<TChannel>> | ModelSetupIpcResult<TChannel>
): void {
  registerValidatedIpcHandle(
    ipcMain,
    channel,
    modelSetupIpcArgsSchemas[channel] as ZodType<ModelSetupIpcArgs<TChannel>>,
    handler
  )
}
