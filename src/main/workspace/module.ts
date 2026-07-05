import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { WorkspaceController } from "./controller"
import { WorkspaceRepository } from "./repository"
import { WorkspaceService } from "./service"
import { JingleMemoryService } from "../jingle-memory/service"
import { ThreadWorkspaceService } from "../thread-workspace/service"

export function registerWorkspaceModule(container: DependencyContainer): void {
  container.register(WorkspaceRepository, {
    useFactory: instanceCachingFactory(() => {
      return new WorkspaceRepository()
    })
  })
  container.register(WorkspaceService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new WorkspaceService(
        dependencyContainer.resolve(WorkspaceRepository),
        dependencyContainer.resolve(ThreadWorkspaceService),
        dependencyContainer.resolve(JingleMemoryService)
      )
    })
  })
  container.register(WorkspaceController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new WorkspaceController(dependencyContainer.resolve(WorkspaceService))
    })
  })
}

export function registerWorkspaceIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(WorkspaceController).register(ipcMain)
}

export function resolveWorkspaceService(container: DependencyContainer): WorkspaceService {
  return container.resolve(WorkspaceService)
}
