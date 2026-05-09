import type { IpcMain } from "electron"
import type { SetDefaultModelParams, SetProviderCredentialsParams } from "../types"
import { registerIpcHandle } from "../ipc/handle"
import { ModelProviderService } from "./service"

export class ModelProviderController {
  constructor(private readonly modelProviderService: ModelProviderService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "models:list", async (_event, modelType: string = "llm") => {
      return this.modelProviderService.listModels(modelType)
    })

    registerIpcHandle(ipcMain, "models:listByProvider", async (_event, provider: string, modelType: string = "llm") => {
      return this.modelProviderService.listModelsByProvider(provider, modelType)
    })

    registerIpcHandle(ipcMain, "models:getState", async () => {
      return this.modelProviderService.getState()
    })

    registerIpcHandle(ipcMain, "models:getDefault", async (_event, modelType: string) => {
      return this.modelProviderService.getDefaultModel(modelType)
    })

    registerIpcHandle(
      ipcMain,
      "models:setDefault",
      async (_event, { modelType, modelId }: SetDefaultModelParams) => {
        await this.modelProviderService.setDefaultModel(modelType, modelId)
      }
    )

    registerIpcHandle(
      ipcMain,
      "models:setCredentials",
      async (_event, { provider, credentials }: SetProviderCredentialsParams) => {
        await this.modelProviderService.setCredentials(provider, credentials)
      }
    )

    registerIpcHandle(ipcMain, "models:getCredentials", async (_event, provider: string) => {
      return this.modelProviderService.getCredentials(provider)
    })

    registerIpcHandle(ipcMain, "models:deleteCredentials", async (_event, provider: string) => {
      this.modelProviderService.deleteCredentials(provider)
    })
  }
}
