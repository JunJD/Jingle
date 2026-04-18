import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { LocalStartController } from "./controller"
import { LocalStartRepository } from "./repository"
import { LocalStartService } from "./service"

export function registerLocalStartModule(container: DependencyContainer): void {
  container.register(LocalStartRepository, {
    useFactory: instanceCachingFactory(() => {
      return new LocalStartRepository()
    })
  })
  container.register(LocalStartService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new LocalStartService(dependencyContainer.resolve(LocalStartRepository))
    })
  })
  container.register(LocalStartController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new LocalStartController(dependencyContainer.resolve(LocalStartService))
    })
  })
}

export function registerLocalStartIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(LocalStartController).register(ipcMain)
}

export function resolveLocalStartService(container: DependencyContainer): LocalStartService {
  return container.resolve(LocalStartService)
}
