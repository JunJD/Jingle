import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { AppInfoController } from "./controller"
import { AppInfoService } from "./service"

export function registerAppInfoModule(container: DependencyContainer): void {
  container.register(AppInfoService, {
    useFactory: instanceCachingFactory(() => {
      return new AppInfoService()
    })
  })
  container.register(AppInfoController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new AppInfoController(dependencyContainer.resolve(AppInfoService))
    })
  })
}

export function registerAppInfoIpcHandlers(container: DependencyContainer, ipcMain: IpcMain): void {
  container.resolve(AppInfoController).register(ipcMain)
}
