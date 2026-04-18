import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { SettingsWindowRoutingController } from "./controller"
import {
  SettingsWindowRoutingService,
  type SettingsWindowRoutingRuntime
} from "./service"

const SETTINGS_WINDOW_ROUTING_RUNTIME_TOKEN = Symbol("SettingsWindowRoutingRuntime")

export function registerSettingsWindowRoutingModule(
  container: DependencyContainer,
  runtime: SettingsWindowRoutingRuntime
): void {
  container.registerInstance<SettingsWindowRoutingRuntime>(
    SETTINGS_WINDOW_ROUTING_RUNTIME_TOKEN,
    runtime
  )
  container.register(SettingsWindowRoutingService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new SettingsWindowRoutingService(
        dependencyContainer.resolve(SETTINGS_WINDOW_ROUTING_RUNTIME_TOKEN)
      )
    })
  })
  container.register(SettingsWindowRoutingController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new SettingsWindowRoutingController(
        dependencyContainer.resolve(SettingsWindowRoutingService)
      )
    })
  })
}

export function registerSettingsWindowRoutingIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(SettingsWindowRoutingController).register(ipcMain)
}
