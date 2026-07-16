import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { diagnosticsGraph } from "../diagnostics/instance"
import { ThreadDigestController } from "./controller"
import { ThreadDigestService } from "./service"
import { getWindowIdentity } from "../windows/window-identity"

export function registerThreadDigestModule(container: DependencyContainer): void {
  container.register(ThreadDigestService, {
    useFactory: instanceCachingFactory(() => new ThreadDigestService(diagnosticsGraph))
  })
  container.register(ThreadDigestController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ThreadDigestController(
        dependencyContainer.resolve(ThreadDigestService),
        {
          getMainThreadId: (sender) => {
            const identity = getWindowIdentity(sender)
            return identity?.kind === "main" || identity?.kind === "thread-window" ? identity.threadId : null
          },
          isLauncher: (sender) => getWindowIdentity(sender)?.kind === "launcher"
        },
        undefined,
        diagnosticsGraph
      )
    })
  })
}

export function registerThreadDigestIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(ThreadDigestController).register(ipcMain)
}
