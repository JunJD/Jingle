import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ContentAnnotationsController } from "./controller"
import { ContentAnnotationsService } from "./service"
import { getWindowIdentity, isDurableWindowIdentity } from "../windows/window-identity"

export function registerContentAnnotationsModule(container: DependencyContainer): void {
  container.register(ContentAnnotationsService, {
    useFactory: instanceCachingFactory(() => new ContentAnnotationsService())
  })
  container.register(ContentAnnotationsController, {
    useFactory: instanceCachingFactory(
      (dependencies) =>
        new ContentAnnotationsController(dependencies.resolve(ContentAnnotationsService), {
          getDurableThreadId: (sender) => {
            const identity = getWindowIdentity(sender)
            return isDurableWindowIdentity(identity) ? identity.threadId : null
          },
          isLauncher: (sender) => getWindowIdentity(sender)?.kind === "launcher"
        })
    )
  })
}

export function registerContentAnnotationsIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(ContentAnnotationsController).register(ipcMain)
}
