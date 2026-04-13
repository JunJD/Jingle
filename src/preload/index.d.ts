import type {
  AgentConfig,
  Thread,
  ModelConfig,
  Provider,
  HITLDecision,
  ThreadRuntimeState,
  ThreadHistoryState
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
import type { MainWindowNavigationPayload } from "../shared/main-window"
import type { SettingsWindowNavigationPayload, SettingsWindowTab } from "../shared/settings-window"
import type {
  ArtifactActionId,
  ArtifactActionResolution,
  ArtifactChangedEvent,
  ArtifactRecord
} from "../shared/artifacts"

interface ElectronAPI {
  ipcRenderer: {
    send: (channel: string, ...args: unknown[]) => void
    on: (channel: string, listener: (...args: unknown[]) => void) => () => void
    once: (channel: string, listener: (...args: unknown[]) => void) => void
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  }
  openSettings: () => Promise<void>
  openExternal: (url: string) => Promise<void>
  openSettingsTab: (
    tab: SettingsWindowTab,
    target?: SettingsWindowNavigationPayload["target"]
  ) => Promise<void>
  onSettingsTabChanged: (callback: (payload: SettingsWindowNavigationPayload) => void) => () => void
  process: {
    platform: NodeJS.Platform
    versions: NodeJS.ProcessVersions
  }
}

interface CustomAPI {
  agent: {
    invoke: (
      threadId: string,
      message: AgentInvokeMessage,
      onEvent: (event: IPCEvent) => void,
      modelId?: string
    ) => () => void
    streamAgent: (
      threadId: string,
      message: AgentInvokeMessage,
      command: unknown,
      onEvent: (event: IPCEvent) => void,
      modelId?: string
    ) => () => void
    interrupt: (
      threadId: string,
      decision: HITLDecision,
      onEvent?: (event: IPCEvent) => void
    ) => () => void
    cancel: (threadId: string) => Promise<void>
  }
  threads: {
    list: () => Promise<Thread[]>
    get: (threadId: string) => Promise<Thread | null>
    create: (metadata?: Record<string, unknown>) => Promise<Thread>
    update: (threadId: string, updates: Partial<Thread>) => Promise<Thread>
    delete: (threadId: string) => Promise<void>
    getHistory: (threadId: string) => Promise<ThreadHistoryState>
    getRuntimeState: (threadId: string) => Promise<ThreadRuntimeState>
    generateTitle: (message: string) => Promise<string>
  }
  artifacts: {
    list: (threadId: string) => Promise<ArtifactRecord[]>
    open: (artifactId: string, action?: ArtifactActionId) => Promise<ArtifactActionResolution>
    onChanged: (callback: (event: ArtifactChangedEvent) => void) => () => void
  }
  models: {
    list: () => Promise<ModelConfig[]>
    listProviders: () => Promise<Provider[]>
    getDefault: () => Promise<string>
    deleteApiKey: (provider: string) => Promise<void>
    setDefault: (modelId: string) => Promise<void>
    setApiKey: (provider: string, apiKey: string) => Promise<void>
    getApiKey: (provider: string) => Promise<string | null>
  }
  settings: {
    getAgentConfig: () => Promise<AgentConfig>
    setAgentConfig: (updates: Partial<AgentConfig>) => Promise<AgentConfig>
    getLauncherSettings: () => Promise<LauncherSettings>
    setLauncherSettings: (updates: Partial<LauncherSettings>) => Promise<LauncherSettings>
    openWindow: (payload?: SettingsWindowNavigationPayload) => Promise<void>
    openTab: (payload: SettingsWindowNavigationPayload) => Promise<void>
    getPendingNavigation: () => Promise<SettingsWindowNavigationPayload | null>
  }
  mainWindow: {
    openWindow: (payload?: MainWindowNavigationPayload) => Promise<void>
    openThread: (threadId: string) => Promise<void>
    getPendingNavigation: () => Promise<MainWindowNavigationPayload | null>
    ackNavigation: (payload: MainWindowNavigationPayload) => Promise<void>
    onNavigate: (callback: (payload: MainWindowNavigationPayload) => void) => () => void
  }
  shortcuts: {
    initialResolvedBindings: ResolvedShortcutBinding[]
    initialSettings: ShortcutSettings
    getSettings: () => Promise<ShortcutSettings>
    setSettings: (updates: Partial<ShortcutSettings>) => Promise<ShortcutSettings>
    onSettingsChanged: (callback: (settings: ShortcutSettings) => void) => () => void
    getResolvedBindings: () => Promise<ResolvedShortcutBinding[]>
    getGlobalAvailability: () => Promise<GlobalShortcutAvailability[]>
  }
  launcher: {
    getClipboardContext: () => Promise<ClipboardContext>
    search: (request: LauncherSearchRequest) => Promise<LauncherSearchResponse>
    executeAction: (action: LauncherSearchAction) => Promise<LauncherActionExecutionResult>
    show: () => Promise<void>
    hide: () => Promise<void>
    setViewportHeight: (height: number) => Promise<void>
    onShown: (callback: () => void) => () => void
  }
  launcherHistory: {
    list: () => Promise<LauncherHistoryItem[]>
    remove: (itemId: string) => Promise<void>
    setPinned: (itemId: string, pin: boolean) => Promise<LauncherHistoryItem>
  }
  localStart: {
    list: () => Promise<LocalStartItem[]>
    upsert: (input: CreateLocalStartItemInput) => Promise<LocalStartItem>
    remove: (itemId: string) => Promise<void>
    recordUse: (itemId: string) => Promise<LocalStartItem>
  }
  nativeExtensions: {
    listSettingsSchemas: () => Promise<InstalledNativeExtensionSettingsSchema[]>
    getPreferences: (extensionName: string) => Promise<Record<string, unknown>>
    setPreferences: (
      extensionName: string,
      nextRecord: Record<string, unknown>
    ) => Promise<Record<string, unknown>>
    getCommandPreferences: (
      extensionName: string,
      commandName: string
    ) => Promise<Record<string, unknown>>
    setCommandPreferences: (
      extensionName: string,
      commandName: string,
      nextRecord: Record<string, unknown>
    ) => Promise<Record<string, unknown>>
    invoke: <TPayload = unknown, TResult = unknown>(
      request: NativeExtensionInvokeRequest<TPayload>
    ) => Promise<TResult>
    onPreferencesChanged: (
      callback: (event: NativeExtensionPreferencesChangedEvent) => void
    ) => () => void
  }
  nativeMenuBar: {
    setState: (state: NativeMenuBarState) => Promise<void>
    clearState: (commandKey: string) => Promise<void>
    onItemSelected: (callback: (event: NativeMenuBarActionEvent) => void) => () => void
  }
  workspace: {
    get: (threadId?: string) => Promise<string | null>
    set: (threadId: string | undefined, path: string | null) => Promise<string | null>
    select: (threadId?: string) => Promise<string | null>
    readFile: (
      threadId: string,
      filePath: string
    ) => Promise<{
      success: boolean
      content?: string
      size?: number
      modified_at?: string
      error?: string
    }>
    readBinaryFile: (
      threadId: string,
      filePath: string
    ) => Promise<{
      success: boolean
      content?: string
      size?: number
      modified_at?: string
      error?: string
    }>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: CustomAPI
  }
}
