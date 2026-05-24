import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { MainWindowRoutingController } from "./controller"
import { MainWindowRoutingService, type MainWindowRoutingRuntime } from "./service"

const MAIN_WINDOW_ROUTING_RUNTIME_TOKEN = Symbol("MainWindowRoutingRuntime")

export function registerMainWindowRoutingModule(
  container: DependencyContainer,
  runtime: MainWindowRoutingRuntime
): void {
  container.registerInstance<MainWindowRoutingRuntime>(MAIN_WINDOW_ROUTING_RUNTIME_TOKEN, runtime)
  container.register(MainWindowRoutingService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new MainWindowRoutingService(
        dependencyContainer.resolve(MAIN_WINDOW_ROUTING_RUNTIME_TOKEN)
      )
    })
  })
  container.register(MainWindowRoutingController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new MainWindowRoutingController(dependencyContainer.resolve(MainWindowRoutingService))
    })
  })
}

export function registerMainWindowRoutingIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(MainWindowRoutingController).register(ipcMain)
}
