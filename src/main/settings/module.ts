import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { SettingsController } from "./controller"
import { SettingsService } from "./service"

export function registerSettingsModule(container: DependencyContainer): void {
  container.register(SettingsService, {
    useFactory: instanceCachingFactory(() => {
      return new SettingsService()
    })
  })
  container.register(SettingsController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new SettingsController(dependencyContainer.resolve(SettingsService))
    })
  })
}

export function registerSettingsIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(SettingsController).register(ipcMain)
}
