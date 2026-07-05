import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ShortcutsController } from "./controller"
import { ShortcutsService } from "./service"

export function registerShortcutsModule(container: DependencyContainer): void {
  container.register(ShortcutsService, {
    useFactory: instanceCachingFactory(() => {
      return new ShortcutsService()
    })
  })
  container.register(ShortcutsController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ShortcutsController(dependencyContainer.resolve(ShortcutsService))
    })
  })
}

export function registerShortcutsIpcHandlers(
  container: DependencyContainer,
  params: { applySettings: () => void; ipcMain: IpcMain }
): void {
  container.resolve(ShortcutsController).register(params)
}
