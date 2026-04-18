import "reflect-metadata"
import type { BrowserWindow, IpcMain } from "electron"
import { container, type DependencyContainer } from "tsyringe"
import { LAUNCHER_COMMAND_IDS } from "../shared/shortcuts/ids"
import { installApplicationMenu } from "./app-menu"
import { registerAppInfoIpcHandlers, registerAppInfoModule } from "./app-info/module"
import { registerAgentHandlers } from "./ipc/agent"
import { registerArtifactsIpcHandlers, registerArtifactsModule } from "./artifacts/module"
import { registerSettingsWindowHandlers } from "./ipc/settings-window"
import {
  registerExternalLinksIpcHandlers,
  registerExternalLinksModule
} from "./external-links/module"
import {
  registerLauncherHistoryIpcHandlers,
  registerLauncherHistoryModule
} from "./launcher-history/module"
import { registerLauncherIpcHandlers, registerLauncherModule } from "./launcher/module"
import {
  registerLocalStartIpcHandlers,
  registerLocalStartModule
} from "./local-start/module"
import {
  registerMainWindowRoutingIpcHandlers,
  registerMainWindowRoutingModule
} from "./main-window-routing/module"
import {
  registerNativeMenuBarIpcHandlers,
  registerNativeMenuBarModule,
  resolveNativeMenuBarService
} from "./native-menu-bar/module"
import {
  registerNativeExtensionsIpcHandlers,
  registerNativeExtensionsModule
} from "./native-extensions/module"
import {
  registerModelProviderIpcHandlers,
  registerModelProviderModule
} from "./model-provider/module"
import {
  getGlobalShortcutAccelerator,
  registerGlobalShortcutService,
  unregisterGlobalShortcutService
} from "./services/shortcuts/global-shortcut-service"
import { registerSettingsIpcHandlers, registerSettingsModule } from "./settings/module"
import { registerShortcutsIpcHandlers, registerShortcutsModule } from "./shortcuts/module"
import { registerThreadsIpcHandlers, registerThreadsModule } from "./threads/module"
import { warmLauncherSearchProviders } from "./services/launcher-search"
import {
  registerWorkspaceIpcHandlers,
  registerWorkspaceModule
} from "./workspace/module"
import type { MainWindowNavigationPayload } from "../shared/main-window"
import type { SettingsWindowNavigationPayload } from "../shared/settings-window"

export interface MainCompositionContext {
  acknowledgePendingMainNavigation: (payload: MainWindowNavigationPayload) => void
  consumePendingSettingsNavigation: () => SettingsWindowNavigationPayload | null
  getLauncherWindow: () => BrowserWindow | null
  getPendingMainNavigation: () => MainWindowNavigationPayload | null
  ipcMain: IpcMain
  isDev: boolean
  openMainWindow: (payload?: MainWindowNavigationPayload) => void
  openSettingsWindow: (payload?: SettingsWindowNavigationPayload) => void
  showLauncherWindow: () => void
  toggleLauncherWindow: () => void
}

const MAIN_COMPOSITION_CONTEXT_TOKEN = Symbol("MainCompositionContext")

export class MainCompositionRoot {
  constructor(
    private readonly context: MainCompositionContext,
    private readonly dependencyContainer: DependencyContainer
  ) {}

  registerIpcHandlers(): void {
    const { ipcMain } = this.context

    registerAgentHandlers(ipcMain)
    registerAppInfoIpcHandlers(this.dependencyContainer, ipcMain)
    registerArtifactsIpcHandlers(this.dependencyContainer, ipcMain)
    registerExternalLinksIpcHandlers(this.dependencyContainer, ipcMain)
    registerLauncherIpcHandlers(this.dependencyContainer, ipcMain)
    registerLauncherHistoryIpcHandlers(this.dependencyContainer, ipcMain)
    registerLocalStartIpcHandlers(this.dependencyContainer, ipcMain)
    registerModelProviderIpcHandlers(this.dependencyContainer, ipcMain)
    registerSettingsIpcHandlers(this.dependencyContainer, ipcMain)
    registerThreadsIpcHandlers(this.dependencyContainer, ipcMain)
    registerWorkspaceIpcHandlers(this.dependencyContainer, ipcMain)
    registerNativeExtensionsIpcHandlers(this.dependencyContainer, ipcMain)
    registerNativeMenuBarIpcHandlers(this.dependencyContainer, ipcMain)
    registerMainWindowRoutingIpcHandlers(this.dependencyContainer, ipcMain)
    registerShortcutsIpcHandlers(this.dependencyContainer, {
      applySettings: () => this.applyShortcutSettings(),
      ipcMain
    })
    registerSettingsWindowHandlers({
      consumePendingNavigation: this.context.consumePendingSettingsNavigation,
      ipcMain,
      openSettingsWindow: this.context.openSettingsWindow
    })
  }

  startServices(): void {
    resolveNativeMenuBarService(this.dependencyContainer).initialize({
      getLauncherWindow: this.context.getLauncherWindow
    })
    this.applyShortcutSettings()
    void warmLauncherSearchProviders()
  }

  dispose(): void {
    resolveNativeMenuBarService(this.dependencyContainer).dispose()
    unregisterGlobalShortcutService()
  }

  private applyShortcutSettings(): void {
    registerGlobalShortcutService({
      onCommand: (commandId) => {
        if (commandId === LAUNCHER_COMMAND_IDS.toggle) {
          this.context.toggleLauncherWindow()
        }
      }
    })
    installApplicationMenu({
      isDev: this.context.isDev,
      launcherShortcutAccelerator: getGlobalShortcutAccelerator(LAUNCHER_COMMAND_IDS.toggle),
      showLauncher: this.context.showLauncherWindow,
      showSettings: () => {
        this.context.openSettingsWindow()
      }
    })
  }
}

export function createMainCompositionRoot(
  context: MainCompositionContext,
  parentContainer: DependencyContainer = container
): MainCompositionRoot {
  const childContainer = parentContainer.createChildContainer()

  childContainer.registerInstance<MainCompositionContext>(MAIN_COMPOSITION_CONTEXT_TOKEN, context)
  registerAppInfoModule(childContainer)
  registerArtifactsModule(childContainer)
  registerExternalLinksModule(childContainer)
  registerLauncherHistoryModule(childContainer)
  registerLocalStartModule(childContainer)
  registerLauncherModule(childContainer, {
    openMainWindow: context.openMainWindow
  })
  registerMainWindowRoutingModule(childContainer, {
    acknowledgePendingNavigation: context.acknowledgePendingMainNavigation,
    getPendingNavigation: context.getPendingMainNavigation,
    openMainWindow: context.openMainWindow
  })
  registerModelProviderModule(childContainer)
  registerNativeExtensionsModule(childContainer)
  registerNativeMenuBarModule(childContainer)
  registerSettingsModule(childContainer)
  registerShortcutsModule(childContainer)
  registerThreadsModule(childContainer)
  registerWorkspaceModule(childContainer)

  return new MainCompositionRoot(
    childContainer.resolve<MainCompositionContext>(MAIN_COMPOSITION_CONTEXT_TOKEN),
    childContainer
  )
}
