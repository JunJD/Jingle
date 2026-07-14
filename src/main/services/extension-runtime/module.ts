import type { IpcMain } from "electron"
import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ExternalLinksService } from "../../external-links/service"
import { ExtensionQuicklinkService } from "../../extension-quicklinks/service"
import { NativeMenuBarService } from "../../native-menu-bar/service"
import { NativeExtensionsService } from "../../native-extensions/service"
import { SettingsService } from "../../settings/service"
import { SettingsWindowRoutingService } from "../../settings-window-routing/service"
import { isLauncherWindowWebContents } from "../../windows/launcher-window"
import { wrapExtensionRuntimeHostForBdd } from "./bdd-host-capabilities"
import { ExtensionRuntimeController } from "./controller"
import { DefaultExtensionRuntimeHostCapabilities } from "./host-capabilities"
import { createExtensionRuntimeExecutionLeaseOwner } from "./execution-lease"
import { ExtensionRuntimeMenuBarService } from "./menu-bar-service"
import { ExtensionRuntimeRendererBridge } from "./renderer-bridge"
import { ExtensionRuntimeManager, type ExtensionRuntimeHostCapabilities } from "./runtime-manager"
import { UtilityProcessExtensionRuntimeProcessLauncher } from "./utility-process-launcher"

const EXTENSION_RUNTIME_HOST_TOKEN = "ExtensionRuntimeHostCapabilities"

export function registerExtensionRuntimeModule(container: DependencyContainer): void {
  container.register(ExtensionRuntimeRendererBridge, {
    useFactory: instanceCachingFactory(() => new ExtensionRuntimeRendererBridge())
  })
  container.register<ExtensionRuntimeHostCapabilities>(EXTENSION_RUNTIME_HOST_TOKEN, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      const rendererBridge = dependencyContainer.resolve(ExtensionRuntimeRendererBridge)
      const host = new DefaultExtensionRuntimeHostCapabilities(
        dependencyContainer.resolve(NativeExtensionsService),
        dependencyContainer.resolve(ExternalLinksService),
        dependencyContainer.resolve(ExtensionQuicklinkService),
        dependencyContainer.resolve(SettingsWindowRoutingService),
        rendererBridge
      )

      return wrapExtensionRuntimeHostForBdd(host)
    })
  })
  container.register(ExtensionRuntimeManager, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      const nativeExtensionsService = dependencyContainer.resolve(NativeExtensionsService)
      const settingsService = dependencyContainer.resolve(SettingsService)
      return new ExtensionRuntimeManager({
        executionLeaseOwner: createExtensionRuntimeExecutionLeaseOwner({
          getLocale: () => settingsService.getAgentConfig().locale
        }),
        host: dependencyContainer.resolve<ExtensionRuntimeHostCapabilities>(
          EXTENSION_RUNTIME_HOST_TOKEN
        ),
        processLauncher: new UtilityProcessExtensionRuntimeProcessLauncher(),
        subscribeConfigurationCommits: (listener) =>
          nativeExtensionsService.onConfigurationCommitted(listener)
      })
    })
  })
  container.register(ExtensionRuntimeController, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ExtensionRuntimeController(
        dependencyContainer.resolve(ExtensionRuntimeManager),
        dependencyContainer.resolve(ExtensionRuntimeRendererBridge),
        isLauncherWindowWebContents
      )
    })
  })
  container.register(ExtensionRuntimeMenuBarService, {
    useFactory: instanceCachingFactory((dependencyContainer) => {
      return new ExtensionRuntimeMenuBarService(
        dependencyContainer.resolve(ExtensionRuntimeManager),
        dependencyContainer.resolve(NativeMenuBarService)
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
