import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { LauncherHistoryService } from "../launcher-history/service"
import { LocalStartService } from "../local-start/service"
import { LauncherController } from "./controller"
import { LauncherService, type LauncherRuntime } from "./service"

const LAUNCHER_RUNTIME_TOKEN = Symbol("LauncherRuntime")

export function registerLauncherModule(
  container: DependencyContainer,
  runtime: LauncherRuntime
): void {
  container.registerInstance<LauncherRuntime>(LAUNCHER_RUNTIME_TOKEN, runtime)
  container.register(LauncherService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new LauncherService(
        dependencyContainer.resolve(LauncherHistoryService),
        dependencyContainer.resolve(LocalStartService),
        dependencyContainer.resolve(LAUNCHER_RUNTIME_TOKEN)
      )
    })
  })
  container.register(LauncherController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new LauncherController(dependencyContainer.resolve(LauncherService))
    })
  })
}

export function registerLauncherIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(LauncherController).register(ipcMain)
}
