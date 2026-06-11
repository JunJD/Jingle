import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { OpenTargetsController } from "./controller"
import { OpenTargetsService } from "./service"

export function registerOpenTargetsModule(container: DependencyContainer): void {
  container.register(OpenTargetsService, {
    useFactory: instanceCachingFactory(() => {
      return new OpenTargetsService()
    })
  })
  container.register(OpenTargetsController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new OpenTargetsController(dependencyContainer.resolve(OpenTargetsService))
    })
  })
}

export function registerOpenTargetsIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(OpenTargetsController).register(ipcMain)
}
