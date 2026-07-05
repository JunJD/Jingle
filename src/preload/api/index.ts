import { agentApi } from "./agent"
import { aiSessionWindowsApi } from "./aiSessionWindows"
import { artifactsApi } from "./artifacts"
import { diagnosticsApi } from "./diagnostics"
import { devtoolsApi } from "./devtools"
import { extensionQuicklinksApi } from "./extensionQuicklinks"
import { extensionRuntimeApi } from "./extensionRuntime"
import { launcherApi } from "./launcher"
import { launcherHistoryApi } from "./launcherHistory"
import { localStartApi } from "./localStart"
import { modelsApi } from "./models"
import { memoryApi } from "./memory"
import { nativeExtensionsApi } from "./nativeExtensions"
import { nativeMenuBarApi } from "./nativeMenuBar"
import { openTargetsApi } from "./openTargets"
import { settingsApi } from "./settings"
import { shortcutsApi } from "./shortcuts"
import { threadSidebarApi } from "./threadSidebar"
import { threadWorkspaceApi } from "./threadWorkspace"
import { threadsApi } from "./threads"
import { workspaceApi } from "./workspace"

export const api = {
  agent: agentApi,
  aiSessionWindows: aiSessionWindowsApi,
  threads: threadsApi,
  artifacts: artifactsApi,
  diagnostics: diagnosticsApi,
  devtools: devtoolsApi,
  extensionQuicklinks: extensionQuicklinksApi,
  extensionRuntime: extensionRuntimeApi,
  memory: memoryApi,
  models: modelsApi,
  settings: settingsApi,
  shortcuts: shortcutsApi,
  threadSidebar: threadSidebarApi,
  threadWorkspace: threadWorkspaceApi,
  launcher: launcherApi,
  launcherHistory: launcherHistoryApi,
  localStart: localStartApi,
  nativeExtensions: nativeExtensionsApi,
  nativeMenuBar: nativeMenuBarApi,
  openTargets: openTargetsApi,
  workspace: workspaceApi
}

export type JingleAPI = typeof api
