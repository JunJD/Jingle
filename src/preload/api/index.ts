import { agentApi } from "./agent"
import { artifactsApi } from "./artifacts"
import { extensionRuntimeApi } from "./extensionRuntime"
import { launcherApi } from "./launcher"
import { launcherHistoryApi } from "./launcherHistory"
import { localStartApi } from "./localStart"
import { mainWindowApi } from "./mainWindow"
import { modelsApi } from "./models"
import { memoryApi } from "./memory"
import { nativeExtensionsApi } from "./nativeExtensions"
import { nativeMenuBarApi } from "./nativeMenuBar"
import { settingsApi } from "./settings"
import { shortcutsApi } from "./shortcuts"
import { threadsApi } from "./threads"
import { workspaceApi } from "./workspace"

export const api = {
  agent: agentApi,
  threads: threadsApi,
  artifacts: artifactsApi,
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
  workspace: workspaceApi
}

export type OpenworkAPI = typeof api
