import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ThreadWorkflowController } from "./controller"
import { ThreadWorkflowService } from "./service"
import { isLauncherWindowWebContents } from "../windows/launcher-window"
import { getPinnedAiSessionWindowThreadId } from "../windows/pinned-ai-session-window"

export function registerThreadWorkflowModule(container: DependencyContainer): void {
  container.register(ThreadWorkflowService, {
    useFactory: instanceCachingFactory(() => new ThreadWorkflowService())
  })
  container.register(ThreadWorkflowController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ThreadWorkflowController(dependencyContainer.resolve(ThreadWorkflowService), {
        getPinnedThreadId: getPinnedAiSessionWindowThreadId,
        isLauncher: isLauncherWindowWebContents
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
