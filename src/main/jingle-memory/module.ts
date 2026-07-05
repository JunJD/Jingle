import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { JingleMemoryController } from "./controller"
import { JingleMemoryService } from "./service"

export function registerJingleMemoryModule(container: DependencyContainer): void {
  container.register(JingleMemoryService, {
    useFactory: instanceCachingFactory(() => {
      return new JingleMemoryService()
    })
  })
  container.register(JingleMemoryController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new JingleMemoryController(dependencyContainer.resolve(JingleMemoryService))
    })
  })
}

export function registerJingleMemoryIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(JingleMemoryController).register(ipcMain)
}

export function resolveJingleMemoryService(
  container: DependencyContainer
): JingleMemoryService {
  return container.resolve(JingleMemoryService)
}
