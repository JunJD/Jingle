import "reflect-metadata"
import type { BrowserWindow, IpcMain } from "electron"
import { container, type DependencyContainer } from "tsyringe"
import { LAUNCHER_COMMAND_IDS } from "../shared/shortcuts/ids"
import { installApplicationMenu } from "./app-menu"
import { registerAgentHandlers } from "./ipc/agent"
import { registerArtifactHandlers } from "./ipc/artifacts"
import { registerExternalLinkHandlers } from "./ipc/external-links"
import { registerMainWindowHandlers } from "./ipc/main-window"
import { registerModelHandlers } from "./ipc/models"
import { registerNativeExtensionHandlers } from "./ipc/native-extensions"
import { registerNativeMenuBarHandlers } from "./ipc/native-menu-bar"
import { registerSettingsWindowHandlers } from "./ipc/settings-window"
import { registerShortcutHandlers } from "./ipc/shortcuts"
import { registerThreadHandlers } from "./ipc/threads"
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
  getGlobalShortcutAccelerator,
  registerGlobalShortcutService,
  unregisterGlobalShortcutService
} from "./services/shortcuts/global-shortcut-service"
import { initializeNativeMenuBar } from "./services/native-menu-bar"
import { warmLauncherSearchProviders } from "./services/launcher-search"
import { registerLauncherHandlers } from "./windows/launcher-window"
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
    registerArtifactHandlers(ipcMain)
    registerExternalLinkHandlers(ipcMain)
    registerLauncherHistoryIpcHandlers(this.dependencyContainer, ipcMain)
    registerLocalStartIpcHandlers(this.dependencyContainer, ipcMain)
    registerThreadHandlers(ipcMain)
    registerModelHandlers(ipcMain)
    registerNativeExtensionHandlers(ipcMain)
    registerNativeMenuBarHandlers(ipcMain)
    registerMainWindowHandlers({
      acknowledgePendingNavigation: this.context.acknowledgePendingMainNavigation,
      getPendingNavigation: this.context.getPendingMainNavigation,
      ipcMain,
      openMainWindow: this.context.openMainWindow
    })
    registerShortcutHandlers({
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
    initializeNativeMenuBar({
      getLauncherWindow: this.context.getLauncherWindow
    })
    this.applyShortcutSettings()
    void warmLauncherSearchProviders()
  }

  dispose(): void {
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
  registerLauncherHistoryModule(childContainer)
  registerLocalStartModule(childContainer)

  return new MainCompositionRoot(
    childContainer.resolve<MainCompositionContext>(MAIN_COMPOSITION_CONTEXT_TOKEN),
    childContainer
  )
}
