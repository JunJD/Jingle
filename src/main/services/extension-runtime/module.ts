import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ExternalLinksService } from "../../external-links/service"
import { NativeMenuBarService } from "../../native-menu-bar/service"
import { NativeExtensionsService } from "../../native-extensions/service"
import { SettingsService } from "../../settings/service"
import { SettingsWindowRoutingService } from "../../settings-window-routing/service"
import { wrapExtensionRuntimeHostForBdd } from "./bdd-host-capabilities"
import { ExtensionRuntimeController } from "./controller"
import { DefaultExtensionRuntimeHostCapabilities } from "./host-capabilities"
import { ExtensionRuntimeMenuBarService } from "./menu-bar-service"
import { ExtensionRuntimeRendererBridge } from "./renderer-bridge"
import { ExtensionRuntimeManager } from "./runtime-manager"
import { UtilityProcessExtensionRuntimeProcessLauncher } from "./utility-process-launcher"

export function registerExtensionRuntimeModule(container: DependencyContainer): void {
  container.register(ExtensionRuntimeRendererBridge, {
    useFactory: instanceCachingFactory(() => new ExtensionRuntimeRendererBridge())
  })
  container.register(ExtensionRuntimeManager, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      const rendererBridge = dependencyContainer.resolve(ExtensionRuntimeRendererBridge)
      const host = new DefaultExtensionRuntimeHostCapabilities(
        dependencyContainer.resolve(NativeExtensionsService),
        dependencyContainer.resolve(ExternalLinksService),
        dependencyContainer.resolve(SettingsWindowRoutingService),
        rendererBridge
      )

      return new ExtensionRuntimeManager({
        host: wrapExtensionRuntimeHostForBdd(host),
        processLauncher: new UtilityProcessExtensionRuntimeProcessLauncher()
      })
    })
  })
  container.register(ExtensionRuntimeController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ExtensionRuntimeController(
        dependencyContainer.resolve(ExtensionRuntimeManager),
        dependencyContainer.resolve(ExtensionRuntimeRendererBridge)
      )
    })
  })
  container.register(ExtensionRuntimeMenuBarService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      const settingsService = dependencyContainer.resolve(SettingsService)
      return new ExtensionRuntimeMenuBarService(
        dependencyContainer.resolve(ExtensionRuntimeManager),
        dependencyContainer.resolve(NativeMenuBarService),
        () => settingsService.getAgentConfig().locale
      )
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

export function resolveExtensionRuntimeMenuBarService(
  container: DependencyContainer
): ExtensionRuntimeMenuBarService {
  return container.resolve(ExtensionRuntimeMenuBarService)
}
