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
import type { AgentMessageContent } from "../shared/message-content"
import type {
  InstalledNativeExtensionSettingsSchema,
  NativeExtensionInvokeRequest
} from "../shared/native-extensions"
import type { SettingsWindowNavigationPayload, SettingsWindowTab } from "../shared/settings-window"

interface ElectronAPI {
  ipcRenderer: {
    send: (channel: string, ...args: unknown[]) => void
    on: (channel: string, listener: (...args: unknown[]) => void) => () => void
    once: (channel: string, listener: (...args: unknown[]) => void) => void
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  }
  openSettings: () => Promise<void>
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
      message: AgentMessageContent,
      onEvent: (event: IPCEvent) => void,
      modelId?: string
    ) => () => void
    streamAgent: (
      threadId: string,
      message: AgentMessageContent,
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
  launcher: {
    getClipboardContext: () => Promise<ClipboardContext>
    search: (request: LauncherSearchRequest) => Promise<LauncherSearchResponse>
    executeAction: (action: LauncherSearchAction) => Promise<LauncherActionExecutionResult>
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
  }
  workspace: {
    get: (threadId?: string) => Promise<string | null>
    set: (threadId: string | undefined, path: string | null) => Promise<string | null>
    select: (threadId?: string) => Promise<string | null>
    loadFromDisk: (threadId: string) => Promise<{
      success: boolean
      files: Array<{
        path: string
        is_dir: boolean
        size?: number
        modified_at?: string
      }>
      workspacePath?: string
      error?: string
    }>
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
    onFilesChanged: (
      callback: (data: { threadId: string; workspacePath: string }) => void
    ) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: CustomAPI
  }
}
