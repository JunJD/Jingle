import { agentApi } from "./agent"
import { aiSessionWindowsApi } from "./aiSessionWindows"
import { artifactsApi } from "./artifacts"
import { diagnosticsApi } from "./diagnostics"
import { extensionQuicklinksApi } from "./extensionQuicklinks"
import { extensionRuntimeApi } from "./extensionRuntime"
import { launcherApi } from "./launcher"
import { launcherHistoryApi } from "./launcherHistory"
import { localStartApi } from "./localStart"
import { mainWindowApi } from "./mainWindow"
import { modelsApi } from "./models"
import { memoryApi } from "./memory"
import { nativeExtensionsApi } from "./nativeExtensions"
import { nativeMenuBarApi } from "./nativeMenuBar"
import { openTargetsApi } from "./openTargets"
import { settingsApi } from "./settings"
import { shortcutsApi } from "./shortcuts"
import { threadsApi } from "./threads"
import { workspaceApi } from "./workspace"

export const api = {
  agent: agentApi,
  aiSessionWindows: aiSessionWindowsApi,
  threads: threadsApi,
  artifacts: artifactsApi,
  diagnostics: diagnosticsApi,
  extensionQuicklinks: extensionQuicklinksApi,
  extensionRuntime: extensionRuntimeApi,
  memory: memoryApi,
  models: modelsApi,
  settings: settingsApi,
  mainWindow: mainWindowApi,
  shortcuts: shortcutsApi,
  launcher: launcherApi,
  launcherHistory: launcherHistoryApi,
  localStart: localStartApi,
  nativeExtensions: nativeExtensionsApi,
  nativeMenuBar: nativeMenuBarApi,
  openTargets: openTargetsApi,
  workspace: workspaceApi
}

export type OpenworkAPI = typeof api
