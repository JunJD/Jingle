import { instanceCachingFactory, type DependencyContainer } from "tsyringe"
import { ExternalLinksService } from "../../external-links/service"
import { NativeExtensionsService } from "../../native-extensions/service"
import { SettingsWindowRoutingService } from "../../settings-window-routing/service"
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
}

export function resolveExtensionRuntimeManager(
  container: DependencyContainer
): ExtensionRuntimeManager {
  return container.resolve(ExtensionRuntimeManager)
}
