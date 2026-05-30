import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import type { IpcMain } from "electron"
import { ExtensionQuicklinkController } from "./controller"
import { ExtensionQuicklinkRepository } from "./repository"
import { ExtensionQuicklinkService } from "./service"

export function registerExtensionQuicklinkModule(container: DependencyContainer): void {
  container.register(ExtensionQuicklinkRepository, {
    useFactory: instanceCachingFactory(() => new ExtensionQuicklinkRepository())
  })
  container.register(ExtensionQuicklinkService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ExtensionQuicklinkService(
        dependencyContainer.resolve(ExtensionQuicklinkRepository)
      )
    })
  })
  container.register(ExtensionQuicklinkController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ExtensionQuicklinkController(
        dependencyContainer.resolve(ExtensionQuicklinkService)
      )
    })
  })
}

export function registerExtensionQuicklinkIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(ExtensionQuicklinkController).register(ipcMain)
}

export function resolveExtensionQuicklinkService(
  container: DependencyContainer
): ExtensionQuicklinkService {
  return container.resolve(ExtensionQuicklinkService)
}
