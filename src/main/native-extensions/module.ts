import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { NativeExtensionsController } from "./controller"
import { NativeExtensionsService } from "./service"

export function registerNativeExtensionsModule(container: DependencyContainer): void {
  container.register(NativeExtensionsService, {
    useFactory: instanceCachingFactory(() => {
      return new NativeExtensionsService()
    })
  })
  container.register(NativeExtensionsController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new NativeExtensionsController(dependencyContainer.resolve(NativeExtensionsService))
    })
  })
}

export function registerNativeExtensionsIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(NativeExtensionsController).register(ipcMain)
}
