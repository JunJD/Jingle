import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ArtifactsService } from "../artifacts/service"
import { ModelProviderService } from "../model-provider/service"
import { SettingsService } from "../settings/service"
import { WorkspaceService } from "../workspace/service"
import { ThreadsController } from "./controller"
import { ThreadsService } from "./service"

export function registerThreadsModule(container: DependencyContainer): void {
  container.register(ThreadsService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ThreadsService(
        dependencyContainer.resolve(ArtifactsService),
        dependencyContainer.resolve(ModelProviderService),
        dependencyContainer.resolve(SettingsService),
        dependencyContainer.resolve(WorkspaceService)
      )
    })
  })
  container.register(ThreadsController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ThreadsController(dependencyContainer.resolve(ThreadsService))
    })
  })
}

export function registerThreadsIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(ThreadsController).register(ipcMain)
}
