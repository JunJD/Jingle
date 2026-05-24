import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { OpenworkMemoryController } from "./controller"
import { OpenworkMemoryService } from "./service"

export function registerOpenworkMemoryModule(container: DependencyContainer): void {
  container.register(OpenworkMemoryService, {
    useFactory: instanceCachingFactory(() => {
      return new OpenworkMemoryService()
    })
  })
  container.register(OpenworkMemoryController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new OpenworkMemoryController(dependencyContainer.resolve(OpenworkMemoryService))
    })
  })
}

export function registerOpenworkMemoryIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(OpenworkMemoryController).register(ipcMain)
}

export function resolveOpenworkMemoryService(
  container: DependencyContainer
): OpenworkMemoryService {
  return container.resolve(OpenworkMemoryService)
}
