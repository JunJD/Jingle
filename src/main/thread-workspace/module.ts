import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ThreadWorkspaceController } from "./controller"
import { ThreadWorkspaceRepository } from "./repository"
import { ThreadWorkspaceService } from "./service"

export function registerThreadWorkspaceModule(container: DependencyContainer): void {
  container.register(ThreadWorkspaceRepository, {
    useFactory: instanceCachingFactory(() => {
      return new ThreadWorkspaceRepository()
    })
  })
  container.register(ThreadWorkspaceService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ThreadWorkspaceService(dependencyContainer.resolve(ThreadWorkspaceRepository))
    })
  })
  container.register(ThreadWorkspaceController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ThreadWorkspaceController(dependencyContainer.resolve(ThreadWorkspaceService))
    })
  })
}

export function registerThreadWorkspaceIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(ThreadWorkspaceController).register(ipcMain)
}

export function resolveThreadWorkspaceService(
  container: DependencyContainer
): ThreadWorkspaceService {
  return container.resolve(ThreadWorkspaceService)
}
