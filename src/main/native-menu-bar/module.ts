import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { NativeMenuBarController } from "./controller"
import { NativeMenuBarService } from "./service"

export function registerNativeMenuBarModule(container: DependencyContainer): void {
  container.register(NativeMenuBarService, {
    useFactory: instanceCachingFactory(() => {
      return new NativeMenuBarService()
    })
  })
  container.register(NativeMenuBarController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new NativeMenuBarController(dependencyContainer.resolve(NativeMenuBarService))
    })
  })
}

export function registerNativeMenuBarIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(NativeMenuBarController).register(ipcMain)
}

export function resolveNativeMenuBarService(container: DependencyContainer): NativeMenuBarService {
  return container.resolve(NativeMenuBarService)
}
