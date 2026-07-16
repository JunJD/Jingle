import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { diagnosticsLogger } from "../diagnostics/instance"
import { ThreadDigestController } from "./controller"
import { ThreadDigestService } from "./service"
import { isLauncherWindowWebContents } from "../windows/launcher-window"
import { getPinnedAiSessionWindowThreadId } from "../windows/pinned-ai-session-window"

export function registerThreadDigestModule(container: DependencyContainer): void {
  container.register(ThreadDigestService, {
    useFactory: instanceCachingFactory(() => new ThreadDigestService(diagnosticsLogger))
  })
  container.register(ThreadDigestController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ThreadDigestController(
        dependencyContainer.resolve(ThreadDigestService),
        {
          getPinnedThreadId: getPinnedAiSessionWindowThreadId,
          isLauncher: isLauncherWindowWebContents
        },
        undefined,
        diagnosticsLogger
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
