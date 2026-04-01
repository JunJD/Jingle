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
import type { BuiltPluginSettings } from "../shared/built-plugin-settings"
import type { BuiltPluginInvokeRequest } from "../shared/built-plugins/sdk"
import type { AgentMessageContent } from "../shared/message-content"
import type {
  ExternalExtensionBundleResult,
  ExternalExtensionCommandInfo,
  ExternalExtensionSettingsState,
  GetExternalExtensionBundleRequest,
  InstalledExternalExtensionSettingsSchema
} from "../shared/external-extensions"
import type { OAuthTokenRecord } from "../shared/oauth"
import type { SettingsWindowNavigationPayload, SettingsWindowTab } from "../shared/settings-window"

interface ElectronAPI {
  ipcRenderer: {
    send: (channel: string, ...args: unknown[]) => void
    on: (channel: string, listener: (...args: unknown[]) => void) => () => void
    once: (channel: string, listener: (...args: unknown[]) => void) => void
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  }
  onOAuthCallback: (callback: (url: string) => void) => () => void
  onOAuthLogout: (callback: (provider: string) => void) => () => void
  oauthGetToken: (provider: string) => Promise<OAuthTokenRecord | null>
  oauthSetToken: (provider: string, token: OAuthTokenRecord) => Promise<void>
  oauthRemoveToken: (provider: string) => Promise<void>
  oauthLogout: (provider: string) => Promise<void>
  oauthSetFlowActive: (active: boolean) => Promise<void>
  openSettings: () => Promise<void>
  openSettingsTab: (
    tab: SettingsWindowTab,
    target?: SettingsWindowNavigationPayload["target"]
  ) => Promise<void>
  onSettingsTabChanged: (
    callback: (payload: SettingsWindowNavigationPayload) => void
  ) => () => void
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
    getBuiltPluginSettings: () => Promise<BuiltPluginSettings>
    setBuiltPluginSettings: (
      updates: Partial<BuiltPluginSettings>
    ) => Promise<BuiltPluginSettings>
    openWindow: () => Promise<void>
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
  builtPlugins: {
    invoke: <TPayload = unknown, TResult = unknown>(
      request: BuiltPluginInvokeRequest<TPayload>
    ) => Promise<TResult>
  }
  extensions: {
    listCommands: () => Promise<ExternalExtensionCommandInfo[]>
    getBundle: (
      request: GetExternalExtensionBundleRequest
    ) => Promise<ExternalExtensionBundleResult>
    listRoots: () => Promise<string[]>
    listSettingsSchemas: () => Promise<InstalledExternalExtensionSettingsSchema[]>
    getCustomRoots: () => Promise<ExternalExtensionSettingsState["customRoots"]>
    setCustomRoots: (
      nextRoots: ExternalExtensionSettingsState["customRoots"]
    ) => Promise<ExternalExtensionSettingsState["customRoots"]>
    pickRoot: () => Promise<string | null>
    revealPath: (targetPath: string) => Promise<boolean>
    onChanged: (callback: () => void) => () => void
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
