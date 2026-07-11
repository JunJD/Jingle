import type { IpcMain } from "electron"
import { registerIpcHandle, registerValidatedIpcHandle } from "../ipc/handle"
import { legacyModelMutationIpcArgsSchemas } from "./controller-schema"
import { ModelProviderService } from "./service"

export class ModelProviderController {
  constructor(private readonly modelProviderService: ModelProviderService) {}

  register(ipcMain: IpcMain): void {
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
  }
}
