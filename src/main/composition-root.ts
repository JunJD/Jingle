import "reflect-metadata"
import type { BrowserWindow, IpcMain } from "electron"
import { container, type DependencyContainer } from "tsyringe"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import { AgentThreadRunner } from "./agent/agent-thread-runner"
import { AgentController } from "./agent/controller"
import { registerAgentIpcHandlers, registerAgentModule } from "./agent/module"
import { AgentService } from "./agent/service"
import { registerMainWindowIpcHandlers, registerMainWindowModule } from "./main-window/module"
import {
  PrimaryMainWindowService,
  type PrimaryMainWindowRuntime
} from "./main-window/service"
import { ThreadWindowService, type ThreadWindowRuntime } from "./thread-window/service"
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
import { registerThreadDigestIpcHandlers, registerThreadDigestModule } from "./thread-digest/module"
import { ThreadDigestService } from "./thread-digest/service"
import {
  registerThreadWorkspaceIpcHandlers,
  registerThreadWorkspaceModule
} from "./thread-workspace/module"
import {
  registerThreadWorkflowIpcHandlers,
  registerThreadWorkflowModule
} from "./thread-workflow/module"
import {
  shutdownAgentServiceBeforeThreadWorkflowAutomation,
  startThreadWorkflowRuntimeAutomation
} from "./thread-workflow/runtime-automation"
import { ThreadWorkflowService } from "./thread-workflow/service"
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
  createMainWindow: PrimaryMainWindowRuntime["createMainWindow"]
  createThreadWindow: ThreadWindowRuntime["createThreadWindow"]
  enableDevtoolsNetwork: boolean
  getLauncherWindow: () => BrowserWindow | null
  ipcMain: IpcMain
  isDev: boolean
  openIpcNetworkWindow: () => void
  openSettingsWindow: (payload?: SettingsWindowNavigationPayload) => void
  quitApplication: () => void
  showLauncherWindow: () => void
  showMainWindow: () => void
  toggleLauncherWindow: () => void
}

const MAIN_COMPOSITION_CONTEXT_TOKEN = Symbol("MainCompositionContext")

export class MainCompositionRoot {
  private stopNativeIslandAgentStatus: (() => void) | null = null
  private stopLauncherSearchIndexRefresh: (() => void) | null = null
  private stopThreadWorkflowRuntimeAutomation: (() => Promise<void>) | null = null

  constructor(
    private readonly context: MainCompositionContext,
    private readonly dependencyContainer: DependencyContainer
  ) {}

  showMainWindow(threadId?: string): void {
    this.dependencyContainer.resolve(PrimaryMainWindowService).open(threadId ? { threadId } : {})
  }

  registerIpcHandlers(): void {
    const { ipcMain } = this.context

    if (this.context.enableDevtoolsNetwork) {
      registerIpcNetworkHandlers(ipcMain, {
        openWindow: this.context.openIpcNetworkWindow
      })
    }

    registerAgentIpcHandlers(this.dependencyContainer, ipcMain)
    registerMainWindowIpcHandlers(this.dependencyContainer, ipcMain)
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
    registerThreadDigestIpcHandlers(this.dependencyContainer, ipcMain)
    registerThreadSidebarIpcHandlers(this.dependencyContainer, ipcMain)
    registerThreadWorkflowIpcHandlers(this.dependencyContainer, ipcMain)
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
    this.stopThreadWorkflowRuntimeAutomation = startThreadWorkflowRuntimeAutomation({
      agentThreadRunner: this.dependencyContainer.resolve(AgentThreadRunner),
      workflow: this.dependencyContainer.resolve(ThreadWorkflowService)
    })
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
    this.dependencyContainer.resolve(ThreadWindowService).restore()
  }

  async dispose(): Promise<void> {
    this.dependencyContainer.resolve(ThreadWindowService).markApplicationQuitting()
    this.stopNativeIslandAgentStatus?.()
    this.stopNativeIslandAgentStatus = null
    this.stopLauncherSearchIndexRefresh?.()
    this.stopLauncherSearchIndexRefresh = null
    const stopThreadWorkflowRuntimeAutomation = this.stopThreadWorkflowRuntimeAutomation
    this.stopThreadWorkflowRuntimeAutomation = null
    stopNativeSelectionCapture()
    await Promise.all([
      shutdownAgentServiceBeforeThreadWorkflowAutomation({
        flushAgentControllerProjections: () =>
          this.dependencyContainer.resolve(AgentController).flushRuntimeProjections(),
        shutdownAgentService: () => this.dependencyContainer.resolve(AgentService).shutdown(),
        stopAutomation: stopThreadWorkflowRuntimeAutomation
      }),
      this.dependencyContainer.resolve(ThreadDigestService).shutdown()
    ])
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
      showMainWindow: this.context.showMainWindow,
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
  registerMainWindowModule(childContainer, {
    createMainWindow: context.createMainWindow,
    createThreadWindow: context.createThreadWindow,
    quitApplication: context.quitApplication
  })
  registerArtifactsModule(childContainer)
  registerExternalLinksModule(childContainer)
  registerExtensionQuicklinkModule(childContainer, {
    extensionNames: nativeExtensionNames
  })
  registerLauncherHistoryModule(childContainer)
  registerLocalStartModule(childContainer)
  registerLauncherModule(childContainer, {
    openMainWindow: (threadId: string) =>
      childContainer.resolve(PrimaryMainWindowService).open({ threadId })
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
  registerThreadDigestModule(childContainer)
  registerThreadWorkspaceModule(childContainer)
  registerThreadWorkflowModule(childContainer)
  registerThreadSidebarModule(childContainer)
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
