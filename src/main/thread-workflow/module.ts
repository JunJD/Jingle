import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ThreadWorkflowController } from "./controller"
import { ThreadWorkflowService } from "./service"
import { getWindowIdentity } from "../windows/window-identity"

export function registerThreadWorkflowModule(container: DependencyContainer): void {
  container.register(ThreadWorkflowService, {
    useFactory: instanceCachingFactory(() => new ThreadWorkflowService())
  })
  container.register(ThreadWorkflowController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ThreadWorkflowController(dependencyContainer.resolve(ThreadWorkflowService), {
        getMainThreadId: (sender) => {
          const identity = getWindowIdentity(sender)
          return identity?.kind === "main" || identity?.kind === "thread-window" ? identity.threadId : null
        },
        isLauncher: (sender) => getWindowIdentity(sender)?.kind === "launcher"
      })
    })
  })
}

export function registerThreadWorkflowIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(ThreadWorkflowController).register(ipcMain)
}
