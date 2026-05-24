import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { LauncherHistoryController } from "./controller"
import { LauncherHistoryRepository } from "./repository"
import { LauncherHistoryService } from "./service"

export function registerLauncherHistoryModule(container: DependencyContainer): void {
  container.register(LauncherHistoryRepository, {
    useFactory: instanceCachingFactory(() => {
      return new LauncherHistoryRepository()
    })
  })
  container.register(LauncherHistoryService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new LauncherHistoryService(dependencyContainer.resolve(LauncherHistoryRepository))
    })
  })
  container.register(LauncherHistoryController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new LauncherHistoryController(dependencyContainer.resolve(LauncherHistoryService))
    })
  })
}

export function registerLauncherHistoryIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(LauncherHistoryController).register(ipcMain)
}

export function resolveLauncherHistoryService(
  container: DependencyContainer
): LauncherHistoryService {
  return container.resolve(LauncherHistoryService)
}
