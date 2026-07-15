import "reflect-metadata"
import type { BrowserWindow, IpcMain } from "electron"
import { container, type DependencyContainer } from "tsyringe"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import { AgentThreadRunner } from "./agent/agent-thread-runner"
import { registerAgentIpcHandlers, registerAgentModule } from "./agent/module"
import {
  registerAiSessionWindowsIpcHandlers,
  registerAiSessionWindowsModule
} from "./ai-session-windows/module"
import { AiSessionWindowsService, type AiSessionWindowsRuntime } from "./ai-session-windows/service"
import { installApplicationMenu } from "./app-menu"
import { registerArtifactsIpcHandlers, registerArtifactsModule } from "./artifacts/module"
import { registerDiagnosticsIpcHandlers } from "./diagnostics/controller"
import {
  registerExternalLinksIpcHandlers,
  registerExternalLinksModule
} from "./external-links/module"
import { registerIpcNetworkHandlers } from "./ipc/network-controller"
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
} from "./services/extension-runtime/module"
import {
  registerLauncherHistoryIpcHandlers,
  registerLauncherHistoryModule
} from "./launcher-history/module"
import { registerLauncherIpcHandlers, registerLauncherModule } from "./launcher/module"
import { registerLocalStartIpcHandlers, registerLocalStartModule } from "./local-start/module"
import {
  registerNativeMenuBarIpcHandlers,
  registerNativeMenuBarModule,
  resolveNativeMenuBarService
} from "./native-menu-bar/module"
import {
  disposeNativeExtensionMainDefinitionRegistry,
  startNativeExtensionMainDefinitionRegistry
} from "./services/native-extensions"
import {
  registerNativeExtensionsIpcHandlers,
  registerNativeExtensionsModule,
  resolveNativeExtensionsService
} from "./native-extensions/module"
import {
  registerModelProviderIpcHandlers,
  registerModelProviderModule
} from "./model-provider/module"
import { registerJingleMemoryIpcHandlers, registerJingleMemoryModule } from "./jingle-memory/module"
import { registerOpenTargetsIpcHandlers, registerOpenTargetsModule } from "./open-targets/module"
import {
  getGlobalShortcutAccelerator,
  registerGlobalShortcutService,
  unregisterGlobalShortcutService
} from "./services/shortcuts/global-shortcut-service"
import { startNativeMinimalIslandAgentStatus } from "./services/native-minimal-island-agent-status"
import {
  startNativeSelectionCapture,
  stopNativeSelectionCapture
} from "./services/native-selection-capture"
import { LauncherService } from "./launcher/service"
import { registerSettingsIpcHandlers, registerSettingsModule } from "./settings/module"
import {
  registerSettingsWindowRoutingIpcHandlers,
  registerSettingsWindowRoutingModule
} from "./settings-window-routing/module"
import { registerShortcutsIpcHandlers, registerShortcutsModule } from "./shortcuts/module"
import {
  registerThreadSidebarIpcHandlers,
  registerThreadSidebarModule
} from "./thread-sidebar/module"
import {
  registerThreadWorkspaceIpcHandlers,
  registerThreadWorkspaceModule
} from "./thread-workspace/module"
import { registerThreadsIpcHandlers, registerThreadsModule } from "./threads/module"
import {
  startLauncherSearchIndexRefresh,
  warmLauncherSearchProviders
} from "./services/launcher-search"
import { configureQuicklinksLauncherSearchProvider } from "./services/launcher-search/providers/quicklinks"
import { registerWorkspaceIpcHandlers, registerWorkspaceModule } from "./workspace/module"
import { nativeExtensionManifests } from "@extensions/index"
import type { SettingsWindowNavigationPayload } from "@shared/settings-window"

export interface MainCompositionContext {
  consumePendingSettingsNavigation: () => SettingsWindowNavigationPayload | null
  createPinnedAiSessionWindow: AiSessionWindowsRuntime["createPinnedAiSessionWindow"]
  enableDevtoolsNetwork: boolean
  getLauncherWindow: () => BrowserWindow | null
  ipcMain: IpcMain
  isDev: boolean
  openIpcNetworkWindow: () => void
  openSettingsWindow: (payload?: SettingsWindowNavigationPayload) => void
  quitApplication: () => void
  showLauncherWindow: () => void
  showMainSubject: () => void
  setPinnedAiSessionWindowThreadId: AiSessionWindowsRuntime["setPinnedAiSessionWindowThreadId"]
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

    if (this.context.enableDevtoolsNetwork) {
      registerIpcNetworkHandlers(ipcMain, {
        openWindow: this.context.openIpcNetworkWindow
      })
    }

    registerAgentIpcHandlers(this.dependencyContainer, ipcMain)
    registerAiSessionWindowsIpcHandlers(this.dependencyContainer, ipcMain)
    registerArtifactsIpcHandlers(this.dependencyContainer, ipcMain)
    registerDiagnosticsIpcHandlers(ipcMain)
    registerExternalLinksIpcHandlers(this.dependencyContainer, ipcMain)
    registerExtensionQuicklinkIpcHandlers(this.dependencyContainer, ipcMain)
    registerLauncherIpcHandlers(this.dependencyContainer, ipcMain)
    registerLauncherHistoryIpcHandlers(this.dependencyContainer, ipcMain)
    registerLocalStartIpcHandlers(this.dependencyContainer, ipcMain)
    registerModelProviderIpcHandlers(this.dependencyContainer, ipcMain)
    registerJingleMemoryIpcHandlers(this.dependencyContainer, ipcMain)
    registerOpenTargetsIpcHandlers(this.dependencyContainer, ipcMain)
    registerSettingsIpcHandlers(this.dependencyContainer, ipcMain)
    registerThreadSidebarIpcHandlers(this.dependencyContainer, ipcMain)
    registerThreadWorkspaceIpcHandlers(this.dependencyContainer, ipcMain)
    registerThreadsIpcHandlers(this.dependencyContainer, ipcMain)
    registerWorkspaceIpcHandlers(this.dependencyContainer, ipcMain)
    registerNativeExtensionsIpcHandlers(this.dependencyContainer, ipcMain)
    registerNativeMenuBarIpcHandlers(this.dependencyContainer, ipcMain)
    registerSettingsWindowRoutingIpcHandlers(this.dependencyContainer, ipcMain)
    registerExtensionRuntimeIpcHandlers(this.dependencyContainer, ipcMain)
    registerShortcutsIpcHandlers(this.dependencyContainer, {
      applySettings: () => this.applyShortcutSettings(),
      ipcMain
    })
  }

  startServices(): void {
    startNativeExtensionMainDefinitionRegistry()
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
    startNativeSelectionCapture({
      activateSelection: (payload) => {
        this.dependencyContainer.resolve(LauncherService).setSelectionContext(payload)
        this.context.showLauncherWindow()
        this.context.getLauncherWindow()?.webContents.send("launcher:selection-context-updated")
      }
    })
    void warmLauncherSearchProviders()
    void this.dependencyContainer
      .resolve(AiSessionWindowsService)
      .restorePinnedWindows()
      .catch((error) => {
        console.warn("[MainCompositionRoot] Failed to restore pinned AI session windows.", error)
      })
  }

  async dispose(): Promise<void> {
    this.dependencyContainer.resolve(AiSessionWindowsService).markApplicationQuitting()
    this.stopNativeIslandAgentStatus?.()
    this.stopNativeIslandAgentStatus = null
    this.stopLauncherSearchIndexRefresh?.()
    this.stopLauncherSearchIndexRefresh = null
    stopNativeSelectionCapture()
    resolveExtensionRuntimeMenuBarService(this.dependencyContainer).dispose()
    resolveExtensionRuntimeManager(this.dependencyContainer).dispose()
    resolveNativeMenuBarService(this.dependencyContainer).dispose()
    unregisterGlobalShortcutService()
    await disposeNativeExtensionMainDefinitionRegistry()
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
    let showIpcNetwork: (() => void) | undefined
    if (this.context.enableDevtoolsNetwork) {
      showIpcNetwork = this.context.openIpcNetworkWindow
    }

    installApplicationMenu({
      isDev: this.context.isDev,
      showIpcNetwork,
      launcherShortcutAccelerator: getGlobalShortcutAccelerator(LAUNCHER_COMMAND_IDS.toggle),
      showLauncher: this.context.showLauncherWindow,
      showMainSubject: this.context.showMainSubject,
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
  const nativeExtensionNames = nativeExtensionManifests.map((manifest) => manifest.name)

  childContainer.registerInstance<MainCompositionContext>(MAIN_COMPOSITION_CONTEXT_TOKEN, context)
  registerAgentModule(childContainer)
  registerAiSessionWindowsModule(childContainer, {
    createPinnedAiSessionWindow: context.createPinnedAiSessionWindow,
    setPinnedAiSessionWindowThreadId: context.setPinnedAiSessionWindowThreadId
  })
  registerArtifactsModule(childContainer)
  registerExternalLinksModule(childContainer)
  registerExtensionQuicklinkModule(childContainer, {
    extensionNames: nativeExtensionNames
  })
  registerLauncherHistoryModule(childContainer)
  registerLocalStartModule(childContainer)
  registerLauncherModule(childContainer, {
    openPinnedSessionWindow: (threadId: string) => {
      const result = childContainer.resolve(AiSessionWindowsService).openPinnedWindow({ threadId })
      if (!result.ok) {
        console.warn("[Launcher] Pinned AI session window limit reached.", {
          limit: result.limit
        })
      }
    }
  })
  registerModelProviderModule(childContainer)
  registerJingleMemoryModule(childContainer)
  registerOpenTargetsModule(childContainer)
  registerNativeExtensionsModule(childContainer)
  registerNativeMenuBarModule(childContainer)
  registerSettingsModule(childContainer)
  registerSettingsWindowRoutingModule(childContainer, {
    consumePendingNavigation: context.consumePendingSettingsNavigation,
    openSettingsWindow: context.openSettingsWindow
  })
  registerExtensionRuntimeModule(childContainer)
  registerShortcutsModule(childContainer)
  registerThreadSidebarModule(childContainer)
  registerThreadWorkspaceModule(childContainer)
  registerThreadsModule(childContainer)
  registerWorkspaceModule(childContainer)
  configureQuicklinksLauncherSearchProvider({
    listQuicklinks: () => childContainer.resolve(ExtensionQuicklinkService).listQuicklinks()
  })

  return new MainCompositionRoot(
    childContainer.resolve<MainCompositionContext>(MAIN_COMPOSITION_CONTEXT_TOKEN),
    childContainer
  )
}
