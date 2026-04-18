import "reflect-metadata"
import type { BrowserWindow, IpcMain } from "electron"
import { container, type DependencyContainer } from "tsyringe"
import { LAUNCHER_COMMAND_IDS } from "../shared/shortcuts/ids"
import { installApplicationMenu } from "./app-menu"
import { registerAppInfoIpcHandlers, registerAppInfoModule } from "./app-info/module"
import { registerAgentHandlers } from "./ipc/agent"
import { registerArtifactHandlers } from "./ipc/artifacts"
import { registerMainWindowHandlers } from "./ipc/main-window"
import { registerNativeExtensionHandlers } from "./ipc/native-extensions"
import { registerSettingsWindowHandlers } from "./ipc/settings-window"
import { registerThreadHandlers } from "./ipc/threads"
import {
  registerExternalLinksIpcHandlers,
  registerExternalLinksModule
} from "./external-links/module"
import {
  registerLauncherHistoryIpcHandlers,
  registerLauncherHistoryModule,
  resolveLauncherHistoryService
} from "./launcher-history/module"
import {
  registerLocalStartIpcHandlers,
  registerLocalStartModule,
  resolveLocalStartService
} from "./local-start/module"
import {
  registerNativeMenuBarIpcHandlers,
  registerNativeMenuBarModule,
  resolveNativeMenuBarService
} from "./native-menu-bar/module"
import {
  registerModelProviderIpcHandlers,
  registerModelProviderModule,
  resolveModelProviderService
} from "./model-provider/module"
import {
  getGlobalShortcutAccelerator,
  registerGlobalShortcutService,
  unregisterGlobalShortcutService
} from "./services/shortcuts/global-shortcut-service"
import { registerSettingsIpcHandlers, registerSettingsModule } from "./settings/module"
import { registerShortcutsIpcHandlers, registerShortcutsModule } from "./shortcuts/module"
import { warmLauncherSearchProviders } from "./services/launcher-search"
import { registerLauncherHandlers } from "./windows/launcher-window"
import {
  registerWorkspaceIpcHandlers,
  registerWorkspaceModule,
  resolveWorkspaceService
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
    registerArtifactHandlers(ipcMain)
    registerExternalLinksIpcHandlers(this.dependencyContainer, ipcMain)
    registerLauncherHistoryIpcHandlers(this.dependencyContainer, ipcMain)
    registerLocalStartIpcHandlers(this.dependencyContainer, ipcMain)
    registerModelProviderIpcHandlers(this.dependencyContainer, ipcMain)
    registerThreadHandlers({
      ipcMain,
      modelProviderService: resolveModelProviderService(this.dependencyContainer),
      workspaceService: resolveWorkspaceService(this.dependencyContainer)
    })
    registerSettingsIpcHandlers(this.dependencyContainer, ipcMain)
    registerWorkspaceIpcHandlers(this.dependencyContainer, ipcMain)
    registerNativeExtensionHandlers(ipcMain)
    registerNativeMenuBarIpcHandlers(this.dependencyContainer, ipcMain)
    registerMainWindowHandlers({
      acknowledgePendingNavigation: this.context.acknowledgePendingMainNavigation,
      getPendingNavigation: this.context.getPendingMainNavigation,
      ipcMain,
      openMainWindow: this.context.openMainWindow
    })
    registerShortcutsIpcHandlers(this.dependencyContainer, {
      applySettings: () => this.applyShortcutSettings(),
      ipcMain
    })
    registerSettingsWindowHandlers({
      consumePendingNavigation: this.context.consumePendingSettingsNavigation,
      ipcMain,
      openSettingsWindow: this.context.openSettingsWindow
    })
    registerLauncherHandlers({
      ipcMain,
      launcherHistoryService: resolveLauncherHistoryService(this.dependencyContainer),
      localStartService: resolveLocalStartService(this.dependencyContainer),
      openMainWindow: this.context.openMainWindow
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
  registerExternalLinksModule(childContainer)
  registerLauncherHistoryModule(childContainer)
  registerLocalStartModule(childContainer)
  registerModelProviderModule(childContainer)
  registerNativeMenuBarModule(childContainer)
  registerSettingsModule(childContainer)
  registerShortcutsModule(childContainer)
  registerWorkspaceModule(childContainer)

  return new MainCompositionRoot(
    childContainer.resolve<MainCompositionContext>(MAIN_COMPOSITION_CONTEXT_TOKEN),
    childContainer
  )
}
