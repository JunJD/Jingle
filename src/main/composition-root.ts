import "reflect-metadata"
import type { BrowserWindow, IpcMain } from "electron"
import { container, type DependencyContainer } from "tsyringe"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import { AgentThreadRunner } from "./agent/agent-thread-runner"
import { registerAgentIpcHandlers, registerAgentModule } from "./agent/module"
import { installApplicationMenu } from "./app-menu"
import { registerAppInfoIpcHandlers, registerAppInfoModule } from "./app-info/module"
import { registerArtifactsIpcHandlers, registerArtifactsModule } from "./artifacts/module"
import {
  registerExternalLinksIpcHandlers,
  registerExternalLinksModule
} from "./external-links/module"
import {
  registerExtensionQuicklinkIpcHandlers,
  registerExtensionQuicklinkModule
} from "./extension-quicklinks/module"
import { ExtensionQuicklinkService } from "./extension-quicklinks/service"
import {
  registerExtensionRuntimeIpcHandlers,
  registerExtensionRuntimeModule,
  resolveExtensionRuntimeMenuBarService,
  resolveExtensionRuntimeManager
} from "./services/extension-runtime"
import {
  registerLauncherHistoryIpcHandlers,
  registerLauncherHistoryModule
} from "./launcher-history/module"
import { registerLauncherIpcHandlers, registerLauncherModule } from "./launcher/module"
import { registerLocalStartIpcHandlers, registerLocalStartModule } from "./local-start/module"
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
  registerNativeExtensionsModule,
  resolveNativeExtensionsService
} from "./native-extensions/module"
import {
  registerModelProviderIpcHandlers,
  registerModelProviderModule
} from "./model-provider/module"
import {
  registerOpenworkMemoryIpcHandlers,
  registerOpenworkMemoryModule
} from "./openwork-memory/module"
import {
  getGlobalShortcutAccelerator,
  registerGlobalShortcutService,
  unregisterGlobalShortcutService
} from "./services/shortcuts/global-shortcut-service"
import { startNativeMinimalIslandAgentStatus } from "./services/native-minimal-island-agent-status"
import { registerSettingsIpcHandlers, registerSettingsModule } from "./settings/module"
import {
  registerSettingsWindowRoutingIpcHandlers,
  registerSettingsWindowRoutingModule
} from "./settings-window-routing/module"
import { registerShortcutsIpcHandlers, registerShortcutsModule } from "./shortcuts/module"
import { registerThreadsIpcHandlers, registerThreadsModule } from "./threads/module"
import {
  startLauncherSearchIndexRefresh,
  warmLauncherSearchProviders
} from "./services/launcher-search"
import { configureQuicklinksLauncherSearchProvider } from "./services/launcher-search/providers/quicklinks"
import { registerWorkspaceIpcHandlers, registerWorkspaceModule } from "./workspace/module"
import { listNativeExtensionQuicklinkAliases } from "@extensions/index"
import type { MainWindowNavigationPayload } from "@shared/main-window"
import type { SettingsWindowNavigationPayload } from "@shared/settings-window"

export interface MainCompositionContext {
  acknowledgePendingMainNavigation: (payload: MainWindowNavigationPayload) => void
  consumePendingSettingsNavigation: () => SettingsWindowNavigationPayload | null
  getLauncherWindow: () => BrowserWindow | null
  getPendingMainNavigation: () => MainWindowNavigationPayload | null
  ipcMain: IpcMain
  isDev: boolean
  openMainWindow: (payload?: MainWindowNavigationPayload) => void
  openSettingsWindow: (payload?: SettingsWindowNavigationPayload) => void
  quitApplication: () => void
  showLauncherWindow: () => void
  toggleLauncherWindow: () => void
}

const MAIN_COMPOSITION_CONTEXT_TOKEN = Symbol("MainCompositionContext")

export class MainCompositionRoot {
  private stopNativeIslandAgentStatus: (() => void) | null = null
  private stopLauncherSearchIndexRefresh: (() => void) | null = null

  constructor(
    private readonly context: MainCompositionContext,
    private readonly dependencyContainer: DependencyContainer
  ) {}

  registerIpcHandlers(): void {
    const { ipcMain } = this.context

    registerAgentIpcHandlers(this.dependencyContainer, ipcMain)
    registerAppInfoIpcHandlers(this.dependencyContainer, ipcMain)
    registerArtifactsIpcHandlers(this.dependencyContainer, ipcMain)
    registerExternalLinksIpcHandlers(this.dependencyContainer, ipcMain)
    registerExtensionQuicklinkIpcHandlers(this.dependencyContainer, ipcMain)
    registerLauncherIpcHandlers(this.dependencyContainer, ipcMain)
    registerLauncherHistoryIpcHandlers(this.dependencyContainer, ipcMain)
    registerLocalStartIpcHandlers(this.dependencyContainer, ipcMain)
    registerModelProviderIpcHandlers(this.dependencyContainer, ipcMain)
    registerOpenworkMemoryIpcHandlers(this.dependencyContainer, ipcMain)
    registerSettingsIpcHandlers(this.dependencyContainer, ipcMain)
    registerThreadsIpcHandlers(this.dependencyContainer, ipcMain)
    registerWorkspaceIpcHandlers(this.dependencyContainer, ipcMain)
    registerNativeExtensionsIpcHandlers(this.dependencyContainer, ipcMain)
    registerNativeMenuBarIpcHandlers(this.dependencyContainer, ipcMain)
    registerMainWindowRoutingIpcHandlers(this.dependencyContainer, ipcMain)
    registerSettingsWindowRoutingIpcHandlers(this.dependencyContainer, ipcMain)
    registerExtensionRuntimeIpcHandlers(this.dependencyContainer, ipcMain)
    registerShortcutsIpcHandlers(this.dependencyContainer, {
      applySettings: () => this.applyShortcutSettings(),
      ipcMain
    })
  }

  startServices(): void {
    const nativeMenuBarService = resolveNativeMenuBarService(this.dependencyContainer)
    nativeMenuBarService.initialize({
      getLauncherWindow: this.context.getLauncherWindow
    })
    resolveExtensionRuntimeMenuBarService(this.dependencyContainer).start()
    this.stopNativeIslandAgentStatus?.()
    this.stopNativeIslandAgentStatus = startNativeMinimalIslandAgentStatus(
      this.dependencyContainer.resolve(AgentThreadRunner)
    )
    this.applyShortcutSettings()
    this.stopLauncherSearchIndexRefresh?.()
    this.stopLauncherSearchIndexRefresh = startLauncherSearchIndexRefresh({
      onRefresh: () => {
        this.context.getLauncherWindow()?.webContents.send("launcher:search-index-updated")
      }
    })
    void warmLauncherSearchProviders()
  }

  dispose(): void {
    this.stopNativeIslandAgentStatus?.()
    this.stopNativeIslandAgentStatus = null
    this.stopLauncherSearchIndexRefresh?.()
    this.stopLauncherSearchIndexRefresh = null
    resolveExtensionRuntimeMenuBarService(this.dependencyContainer).dispose()
    resolveExtensionRuntimeManager(this.dependencyContainer).dispose()
    resolveNativeMenuBarService(this.dependencyContainer).dispose()
    unregisterGlobalShortcutService()
  }

  async handleOAuthCallback(rawUrl: string): Promise<void> {
    const result = await resolveNativeExtensionsService(
      this.dependencyContainer
    ).finishOAuthCallback(rawUrl)
    this.context.openSettingsWindow({
      tab: "extensions",
      target: {
        extensionName: result.extensionName
      }
    })
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
  const extensionQuicklinkAliases = listNativeExtensionQuicklinkAliases()

  childContainer.registerInstance<MainCompositionContext>(MAIN_COMPOSITION_CONTEXT_TOKEN, context)
  registerAgentModule(childContainer)
  registerAppInfoModule(childContainer)
  registerArtifactsModule(childContainer)
  registerExternalLinksModule(childContainer)
  registerExtensionQuicklinkModule(childContainer, {
    aliases: extensionQuicklinkAliases
  })
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
  registerOpenworkMemoryModule(childContainer)
  registerNativeExtensionsModule(childContainer)
  registerNativeMenuBarModule(childContainer)
  registerSettingsModule(childContainer)
  registerSettingsWindowRoutingModule(childContainer, {
    consumePendingNavigation: context.consumePendingSettingsNavigation,
    openSettingsWindow: context.openSettingsWindow
  })
  registerExtensionRuntimeModule(childContainer)
  registerShortcutsModule(childContainer)
  registerThreadsModule(childContainer)
  registerWorkspaceModule(childContainer)
  configureQuicklinksLauncherSearchProvider({
    aliases: extensionQuicklinkAliases,
    listQuicklinks: () => childContainer.resolve(ExtensionQuicklinkService).listQuicklinks()
  })

  return new MainCompositionRoot(
    childContainer.resolve<MainCompositionContext>(MAIN_COMPOSITION_CONTEXT_TOKEN),
    childContainer
  )
}
