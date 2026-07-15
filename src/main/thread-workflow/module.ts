import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ThreadWorkflowController } from "./controller"
import { ThreadWorkflowService } from "./service"

export function registerThreadWorkflowModule(container: DependencyContainer): void {
  container.register(ThreadWorkflowService, {
    useFactory: instanceCachingFactory(() => new ThreadWorkflowService())
  })
  container.register(ThreadWorkflowController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ThreadWorkflowController(dependencyContainer.resolve(ThreadWorkflowService))
    })
  })
}

export function registerThreadWorkflowIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(ThreadWorkflowController).register(ipcMain)
}
