import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ThreadSidebarController } from "./controller"
import { ThreadSidebarRepository } from "./repository"
import { ThreadSidebarService } from "./service"
import { ThreadWorkflowService } from "../thread-workflow/service"

export function registerThreadSidebarModule(container: DependencyContainer): void {
  container.register(ThreadSidebarRepository, {
    useFactory: instanceCachingFactory(() => {
      return new ThreadSidebarRepository()
    })
  })
  container.register(ThreadSidebarService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ThreadSidebarService(
        dependencyContainer.resolve(ThreadSidebarRepository),
        dependencyContainer.resolve(ThreadWorkflowService)
      )
    })
  })
  container.register(ThreadSidebarController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ThreadSidebarController(dependencyContainer.resolve(ThreadSidebarService))
    })
  })
}

export function registerThreadSidebarIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(ThreadSidebarController).register(ipcMain)
}
