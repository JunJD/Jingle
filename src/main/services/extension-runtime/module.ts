import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ExternalLinksService } from "../../external-links/service"
import { NativeExtensionsService } from "../../native-extensions/service"
import { SettingsWindowRoutingService } from "../../settings-window-routing/service"
import { ExtensionRuntimeController } from "./controller"
import { DefaultExtensionRuntimeHostCapabilities } from "./host-capabilities"
import { ExtensionRuntimeManager } from "./runtime-manager"
import { UtilityProcessExtensionRuntimeProcessLauncher } from "./utility-process-launcher"

export function registerExtensionRuntimeModule(container: DependencyContainer): void {
  container.register(ExtensionRuntimeManager, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ExtensionRuntimeManager({
        host: new DefaultExtensionRuntimeHostCapabilities(
          dependencyContainer.resolve(NativeExtensionsService),
          dependencyContainer.resolve(ExternalLinksService),
          dependencyContainer.resolve(SettingsWindowRoutingService)
        ),
        processLauncher: new UtilityProcessExtensionRuntimeProcessLauncher()
      })
    })
  })
  container.register(ExtensionRuntimeController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ExtensionRuntimeController(dependencyContainer.resolve(ExtensionRuntimeManager))
    })
  })
}

export function registerExtensionRuntimeIpcHandlers(
  container: DependencyContainer,
  ipcMain: IpcMain
): void {
  container.resolve(ExtensionRuntimeController).register(ipcMain)
}

export function resolveExtensionRuntimeManager(
  container: DependencyContainer
): ExtensionRuntimeManager {
  return container.resolve(ExtensionRuntimeManager)
}
