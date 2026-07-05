import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ModelProviderController } from "./controller"
import { ModelProviderService } from "./service"

export function registerModelProviderModule(container: DependencyContainer): void {
  container.register(ModelProviderService, {
    useFactory: instanceCachingFactory(() => {
      return new ModelProviderService()
    })
  })
  container.register(ModelProviderController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ModelProviderController(dependencyContainer.resolve(ModelProviderService))
    })
  })
}

export function registerModelProviderIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(ModelProviderController).register(ipcMain)
}

export function resolveModelProviderService(container: DependencyContainer): ModelProviderService {
  return container.resolve(ModelProviderService)
}
