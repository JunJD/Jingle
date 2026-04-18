import type { IpcMain } from "electron"
import type { SetDefaultModelParams, SetProviderCredentialsParams } from "../types"
import { ModelProviderService } from "./service"

export class ModelProviderController {
  constructor(private readonly modelProviderService: ModelProviderService) {}

  register(ipcMain: IpcMain): void {
    ipcMain.handle("models:list", async (_event, modelType: string = "llm") => {
      return this.modelProviderService.listModels(modelType)
    })

    ipcMain.handle("models:listByProvider", async (_event, provider: string, modelType = "llm") => {
      return this.modelProviderService.listModelsByProvider(provider, modelType)
    })

    ipcMain.handle("models:getState", async () => {
      return this.modelProviderService.getState()
    })

    ipcMain.handle("models:getDefault", async (_event, modelType: string) => {
      return this.modelProviderService.getDefaultModel(modelType)
    })

    ipcMain.handle(
      "models:setDefault",
      async (_event, { modelType, modelId }: SetDefaultModelParams) => {
        await this.modelProviderService.setDefaultModel(modelType, modelId)
      }
    )

    ipcMain.handle(
      "models:setCredentials",
      async (_event, { provider, credentials }: SetProviderCredentialsParams) => {
        await this.modelProviderService.setCredentials(provider, credentials)
      }
    )

    ipcMain.handle("models:deleteCredentials", async (_event, provider: string) => {
      this.modelProviderService.deleteCredentials(provider)
    })
  }
}
