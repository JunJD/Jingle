import { contextBridge, ipcRenderer } from "electron"
import { resolveShortcutPlatform } from "../shared/shortcuts/model"
import type {
  AgentConfig,
  Thread,
  ModelConfig,
  ModelProviderState,
  ModelType,
  ProviderId,
  HITLDecision,
  ThreadRuntimeState
} from "../shared/app-types"
import type { IPCEvent } from "../types"
import type {
  LauncherActionExecutionResult,
  LauncherSearchAction,
  LauncherSearchRequest,
  LauncherSearchResponse
} from "../shared/launcher-search"
import type { ClipboardContext } from "../shared/clipboard"
import type { LauncherHistoryItem } from "../shared/launcher-history"
import type { CreateLocalStartItemInput, LocalStartItem } from "../shared/local-start"
import type { LauncherSettings } from "../shared/launcher-settings"
import type { AgentInvokeMessage } from "../shared/message-content"
import type {
  InstalledNativeExtensionSettingsSchema,
  NativeExtensionInvokeRequest,
  NativeExtensionPreferencesChangedEvent
} from "../shared/native-extensions"
import type { NativeMenuBarActionEvent, NativeMenuBarState } from "../shared/native-menu-bar"
import type {
  GlobalShortcutAvailability,
  ResolvedShortcutBinding,
  ShortcutSettings
} from "../shared/shortcuts/settings"
import { resolveShortcutBindings } from "../shared/shortcuts/settings"
import type { MainWindowNavigationPayload } from "../shared/main-window"
import type { SettingsWindowNavigationPayload, SettingsWindowTab } from "../shared/settings-window"
import type {
  ArtifactActionId,
  ArtifactActionResolution,
  ArtifactChangedEvent,
  ArtifactRecord
} from "../shared/artifacts"

// Simple electron API - replaces @electron-toolkit/preload
const electronAPI = {
  ipcRenderer: {
    send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      ipcRenderer.on(channel, (_event, ...args) => listener(...args))
      return () => ipcRenderer.removeListener(channel, listener)
    },
    once: (channel: string, listener: (...args: unknown[]) => void) => {
      ipcRenderer.once(channel, (_event, ...args) => listener(...args))
    },
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
  },
  openSettings: (): Promise<void> => {
    return ipcRenderer.invoke("settings:openWindow")
  },
  openExternal: (url: string): Promise<void> => {
    return ipcRenderer.invoke("shell:openExternal", url)
  },
  openSettingsTab: (
    tab: SettingsWindowTab,
    target?: SettingsWindowNavigationPayload["target"]
  ): Promise<void> => {
    return ipcRenderer.invoke("settings:openTab", { tab, ...(target ? { target } : {}) })
  },
  onSettingsTabChanged: (
    callback: (payload: SettingsWindowNavigationPayload) => void
  ): (() => void) => {
    const listener = (_event: unknown, payload: SettingsWindowNavigationPayload): void => {
      callback(payload)
    }

    ipcRenderer.on("settings-tab-changed", listener)
    return () => {
      ipcRenderer.removeListener("settings-tab-changed", listener)
    }
  },
  process: {
    platform: process.platform,
    versions: process.versions
  }
}

const initialShortcutSettings = ipcRenderer.sendSync(
  "shortcuts:getBootstrapSettingsSync"
) as ShortcutSettings
const initialResolvedShortcutBindings = resolveShortcutBindings(
  initialShortcutSettings,
  resolveShortcutPlatform(process.platform)
)

// Custom APIs for renderer
const api = {
  agent: {
    // Send message and receive events via callback
    invoke: (
      threadId: string,
      message: AgentInvokeMessage,
      onEvent: (event: IPCEvent) => void,
      modelId?: string
    ): (() => void) => {
      const channel = `agent:stream:${threadId}`

      const handler = (_: unknown, data: IPCEvent): void => {
        onEvent(data)
        if (data.type === "done" || data.type === "error") {
          ipcRenderer.removeListener(channel, handler)
        }
      }

      ipcRenderer.on(channel, handler)
      ipcRenderer.send("agent:invoke", { threadId, message, modelId })

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(channel, handler)
      }
    },
    // Stream agent events for useStream transport
    streamAgent: (
      threadId: string,
      message: AgentInvokeMessage,
      command: unknown,
      onEvent: (event: IPCEvent) => void,
      modelId?: string
    ): (() => void) => {
      const channel = `agent:stream:${threadId}`

      const handler = (_: unknown, data: IPCEvent): void => {
        onEvent(data)
        if (data.type === "done" || data.type === "error") {
          ipcRenderer.removeListener(channel, handler)
        }
      }

      ipcRenderer.on(channel, handler)

      // If we have a command, it might be a resume/retry
      if (command) {
        ipcRenderer.send("agent:resume", { threadId, command, modelId })
      } else {
        ipcRenderer.send("agent:invoke", { threadId, message, modelId })
      }

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(channel, handler)
      }
    },
    interrupt: (
      threadId: string,
      decision: HITLDecision,
      onEvent?: (event: IPCEvent) => void
    ): (() => void) => {
      const channel = `agent:stream:${threadId}`

      const handler = (_: unknown, data: IPCEvent): void => {
        onEvent?.(data)
        if (data.type === "done" || data.type === "error") {
          ipcRenderer.removeListener(channel, handler)
        }
      }

      ipcRenderer.on(channel, handler)
      ipcRenderer.send("agent:interrupt", { threadId, decision })

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener(channel, handler)
      }
    },
    cancel: (threadId: string): Promise<void> => {
      return ipcRenderer.invoke("agent:cancel", { threadId })
    }
  },
  threads: {
    list: (): Promise<Thread[]> => {
      return ipcRenderer.invoke("threads:list")
    },
    get: (threadId: string): Promise<Thread | null> => {
      return ipcRenderer.invoke("threads:get", threadId)
    },
    create: (metadata?: Record<string, unknown>): Promise<Thread> => {
      return ipcRenderer.invoke("threads:create", metadata)
    },
    update: (threadId: string, updates: Partial<Thread>): Promise<Thread> => {
      return ipcRenderer.invoke("threads:update", { threadId, updates })
    },
    delete: (threadId: string): Promise<void> => {
      return ipcRenderer.invoke("threads:delete", threadId)
    },
    getHistory: (threadId: string) => {
      return ipcRenderer.invoke("threads:history", threadId)
    },
    getRuntimeState: (threadId: string): Promise<ThreadRuntimeState> => {
      return ipcRenderer.invoke("threads:runtimeState", threadId)
    },
    generateTitle: (message: string): Promise<string> => {
      return ipcRenderer.invoke("threads:generateTitle", message)
    }
  },
  artifacts: {
    list: (threadId: string): Promise<ArtifactRecord[]> => {
      return ipcRenderer.invoke("artifacts:list", threadId)
    },
    open: (artifactId: string, action?: ArtifactActionId): Promise<ArtifactActionResolution> => {
      return ipcRenderer.invoke("artifacts:open", { action, artifactId })
    },
    onChanged: (callback: (event: ArtifactChangedEvent) => void) => {
      const listener = (_event: unknown, payload: ArtifactChangedEvent): void => {
        callback(payload as ArtifactChangedEvent)
      }

      ipcRenderer.on("artifacts:changed", listener)
      return () => {
        ipcRenderer.removeListener("artifacts:changed", listener)
      }
    }
  },
  models: {
    getState: (): Promise<ModelProviderState> => {
      return ipcRenderer.invoke("models:getState")
    },
    list: (modelType?: ModelType): Promise<ModelConfig[]> => {
      return ipcRenderer.invoke("models:list", modelType)
    },
    listByProvider: (provider: ProviderId, modelType?: ModelType): Promise<ModelConfig[]> => {
      return ipcRenderer.invoke("models:listByProvider", provider, modelType)
    },
    getDefault: (modelType: "llm"): Promise<string> => {
      return ipcRenderer.invoke("models:getDefault", modelType)
    },
    setDefault: (modelType: "llm", modelId: string): Promise<void> => {
      return ipcRenderer.invoke("models:setDefault", { modelId, modelType })
    },
    setCredentials: (provider: ProviderId, credentials: Record<string, string>): Promise<void> => {
      return ipcRenderer.invoke("models:setCredentials", { credentials, provider })
    },
    deleteCredentials: (provider: ProviderId): Promise<void> => {
      return ipcRenderer.invoke("models:deleteCredentials", provider)
    }
  },
  settings: {
    getAgentConfig: (): Promise<AgentConfig> => {
      return ipcRenderer.invoke("settings:getAgentConfig")
    },
    setAgentConfig: (updates: Partial<AgentConfig>): Promise<AgentConfig> => {
      return ipcRenderer.invoke("settings:setAgentConfig", updates)
    },
    getLauncherSettings: (): Promise<LauncherSettings> => {
      return ipcRenderer.invoke("settings:getLauncherSettings")
    },
    setLauncherSettings: (updates: Partial<LauncherSettings>): Promise<LauncherSettings> => {
      return ipcRenderer.invoke("settings:setLauncherSettings", updates)
    },
    openWindow: (payload?: SettingsWindowNavigationPayload): Promise<void> => {
      return ipcRenderer.invoke("settings:openWindow", payload)
    },
    openTab: (payload: SettingsWindowNavigationPayload): Promise<void> => {
      return ipcRenderer.invoke("settings:openTab", payload)
    },
    getPendingNavigation: (): Promise<SettingsWindowNavigationPayload | null> => {
      return ipcRenderer.invoke("settings:getPendingNavigation")
    }
  },
  mainWindow: {
    openWindow: (payload?: MainWindowNavigationPayload): Promise<void> => {
      return ipcRenderer.invoke("main-window:openWindow", payload)
    },
    openThread: (threadId: string): Promise<void> => {
      return ipcRenderer.invoke("main-window:openThread", threadId)
    },
    getPendingNavigation: (): Promise<MainWindowNavigationPayload | null> => {
      return ipcRenderer.invoke("main-window:getPendingNavigation")
    },
    ackNavigation: (payload: MainWindowNavigationPayload): Promise<void> => {
      return ipcRenderer.invoke("main-window:ackNavigation", payload)
    },
    onNavigate: (callback: (payload: MainWindowNavigationPayload) => void): (() => void) => {
      const handler = (_event: unknown, payload: MainWindowNavigationPayload): void => {
        callback(payload)
      }

      ipcRenderer.on("main-window:navigate", handler)
      return () => {
        ipcRenderer.removeListener("main-window:navigate", handler)
      }
    }
  },
  shortcuts: {
    initialResolvedBindings: initialResolvedShortcutBindings,
    initialSettings: initialShortcutSettings,
    getSettings: (): Promise<ShortcutSettings> => {
      return ipcRenderer.invoke("shortcuts:getSettings")
    },
    setSettings: (updates: Partial<ShortcutSettings>): Promise<ShortcutSettings> => {
      return ipcRenderer.invoke("shortcuts:setSettings", updates)
    },
    onSettingsChanged: (callback: (settings: ShortcutSettings) => void): (() => void) => {
      const handler = (_event: unknown, settings: ShortcutSettings): void => {
        callback(settings)
      }

      ipcRenderer.on("shortcuts:settingsChanged", handler)
      return () => {
        ipcRenderer.removeListener("shortcuts:settingsChanged", handler)
      }
    },
    getResolvedBindings: (): Promise<ResolvedShortcutBinding[]> => {
      return ipcRenderer.invoke("shortcuts:getResolvedBindings")
    },
    getGlobalAvailability: (): Promise<GlobalShortcutAvailability[]> => {
      return ipcRenderer.invoke("shortcuts:getGlobalAvailability")
    }
  },
  launcher: {
    getClipboardContext: (): Promise<ClipboardContext> => {
      return ipcRenderer.invoke("launcher:getClipboardContext")
    },
    search: (request: LauncherSearchRequest): Promise<LauncherSearchResponse> => {
      return ipcRenderer.invoke("launcher:search", request)
    },
    executeAction: (action: LauncherSearchAction): Promise<LauncherActionExecutionResult> => {
      return ipcRenderer.invoke("launcher:executeAction", action)
    },
    show: (): Promise<void> => {
      return ipcRenderer.invoke("launcher:show")
    },
    hide: (): Promise<void> => {
      return ipcRenderer.invoke("launcher:hide")
    },
    setViewportHeight: (height: number): Promise<void> => {
      return ipcRenderer.invoke("launcher:setViewportHeight", height)
    },
    onShown: (callback: () => void): (() => void) => {
      const handler = (): void => {
        callback()
      }
      ipcRenderer.on("launcher:shown", handler)
      return () => {
        ipcRenderer.removeListener("launcher:shown", handler)
      }
    }
  },
  launcherHistory: {
    list: (): Promise<LauncherHistoryItem[]> => {
      return ipcRenderer.invoke("launcherHistory:list")
    },
    remove: (itemId: string): Promise<void> => {
      return ipcRenderer.invoke("launcherHistory:remove", itemId)
    },
    setPinned: (itemId: string, pin: boolean): Promise<LauncherHistoryItem> => {
      return ipcRenderer.invoke("launcherHistory:setPinned", itemId, pin)
    }
  },
  localStart: {
    list: (): Promise<LocalStartItem[]> => {
      return ipcRenderer.invoke("localStart:list")
    },
    upsert: (input: CreateLocalStartItemInput): Promise<LocalStartItem> => {
      return ipcRenderer.invoke("localStart:upsert", input)
    },
    remove: (itemId: string): Promise<void> => {
      return ipcRenderer.invoke("localStart:remove", itemId)
    },
    recordUse: (itemId: string): Promise<LocalStartItem> => {
      return ipcRenderer.invoke("localStart:recordUse", itemId)
    }
  },
  nativeExtensions: {
    listSettingsSchemas: (): Promise<InstalledNativeExtensionSettingsSchema[]> => {
      return ipcRenderer.invoke("nativeExtensions:listSettingsSchemas")
    },
    getPreferences: (extensionName: string): Promise<Record<string, unknown>> => {
      return ipcRenderer.invoke("nativeExtensions:getPreferences", extensionName)
    },
    setPreferences: (
      extensionName: string,
      nextRecord: Record<string, unknown>
    ): Promise<Record<string, unknown>> => {
      return ipcRenderer.invoke("nativeExtensions:setPreferences", extensionName, nextRecord)
    },
    getCommandPreferences: (
      extensionName: string,
      commandName: string
    ): Promise<Record<string, unknown>> => {
      return ipcRenderer.invoke(
        "nativeExtensions:getCommandPreferences",
        extensionName,
        commandName
      )
    },
    setCommandPreferences: (
      extensionName: string,
      commandName: string,
      nextRecord: Record<string, unknown>
    ): Promise<Record<string, unknown>> => {
      return ipcRenderer.invoke(
        "nativeExtensions:setCommandPreferences",
        extensionName,
        commandName,
        nextRecord
      )
    },
    invoke: <TPayload, TResult>(
      request: NativeExtensionInvokeRequest<TPayload>
    ): Promise<TResult> => {
      return ipcRenderer.invoke("nativeExtensions:invoke", request)
    },
    onPreferencesChanged: (
      callback: (event: NativeExtensionPreferencesChangedEvent) => void
    ): (() => void) => {
      const handler = (_event: unknown, payload: NativeExtensionPreferencesChangedEvent): void => {
        callback(payload)
      }

      ipcRenderer.on("nativeExtensions:preferencesChanged", handler)
      return () => {
        ipcRenderer.removeListener("nativeExtensions:preferencesChanged", handler)
      }
    }
  },
  nativeMenuBar: {
    setState: (state: NativeMenuBarState): Promise<void> => {
      return ipcRenderer.invoke("nativeMenuBar:setState", state)
    },
    clearState: (commandKey: string): Promise<void> => {
      return ipcRenderer.invoke("nativeMenuBar:clearState", commandKey)
    },
    onItemSelected: (callback: (event: NativeMenuBarActionEvent) => void): (() => void) => {
      const handler = (_event: unknown, payload: NativeMenuBarActionEvent): void => {
        callback(payload)
      }

      ipcRenderer.on("nativeMenuBar:itemSelected", handler)
      return () => {
        ipcRenderer.removeListener("nativeMenuBar:itemSelected", handler)
      }
    }
  },
  workspace: {
    get: (threadId?: string): Promise<string | null> => {
      return ipcRenderer.invoke("workspace:get", threadId)
    },
    set: (threadId: string | undefined, path: string | null): Promise<string | null> => {
      return ipcRenderer.invoke("workspace:set", { threadId, path })
    },
    select: (threadId?: string): Promise<string | null> => {
      return ipcRenderer.invoke("workspace:select", threadId)
    },
    readFile: (
      threadId: string,
      filePath: string
    ): Promise<{
      success: boolean
      content?: string
      size?: number
      modified_at?: string
      error?: string
    }> => {
      return ipcRenderer.invoke("workspace:readFile", { threadId, filePath })
    },
    readBinaryFile: (
      threadId: string,
      filePath: string
    ): Promise<{
      success: boolean
      content?: string
      size?: number
      modified_at?: string
      error?: string
    }> => {
      return ipcRenderer.invoke("workspace:readBinaryFile", { threadId, filePath })
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI)
    contextBridge.exposeInMainWorld("api", api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
