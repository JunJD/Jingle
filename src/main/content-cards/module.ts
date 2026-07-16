import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { getWindowIdentity, isDurableWindowIdentity } from "../windows/window-identity"
import { ContentCardsController } from "./controller"
import { ContentCardsService } from "./service"

export function registerContentCardsModule(container: DependencyContainer): void {
  container.register(ContentCardsService, {
    useFactory: instanceCachingFactory(() => new ContentCardsService())
  })
  container.register(ContentCardsController, {
    useFactory: instanceCachingFactory(
      (dependencies) =>
        new ContentCardsController(dependencies.resolve(ContentCardsService), {
          getDurableThreadId: (sender) => {
            const identity = getWindowIdentity(sender)
            return isDurableWindowIdentity(identity) ? identity.threadId : null
          },
          isLauncher: (sender) => getWindowIdentity(sender)?.kind === "launcher"
        })
    )
  })
}

export function registerContentCardsIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(ContentCardsController).register(ipcMain)
}
