import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ExternalLinksController } from "./controller"
import { ExternalLinksService } from "./service"

export function registerExternalLinksModule(container: DependencyContainer): void {
  container.register(ExternalLinksService, {
    useFactory: instanceCachingFactory(() => {
      return new ExternalLinksService()
    })
  })
  container.register(ExternalLinksController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ExternalLinksController(dependencyContainer.resolve(ExternalLinksService))
    })
  })
}

export function registerExternalLinksIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(ExternalLinksController).register(ipcMain)
}
