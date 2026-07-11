import { ipcRenderer } from "electron"
import type { AgentConfig } from "@shared/app-types"
import type { AppThemeSettings } from "@shared/app-theme"
import type { LauncherSettings } from "@shared/launcher-settings"
import type { SettingsWindowNavigationPayload } from "@shared/settings-window"
import { invokeIpc } from "../ipc"

export const settingsApi = {
  getAgentConfig: (): Promise<AgentConfig> => {
    return invokeIpc("settings:getAgentConfig")
  },
  setAgentConfig: (updates: Partial<AgentConfig>): Promise<AgentConfig> => {
    return invokeIpc("settings:setAgentConfig", updates)
  },
  onAgentConfigChanged: (callback: (config: AgentConfig) => void): (() => void) => {
    const handler = (_event: unknown, config: AgentConfig): void => {
      callback(config)
    }

    ipcRenderer.on("settings:agentConfigChanged", handler)
    return () => {
      ipcRenderer.removeListener("settings:agentConfigChanged", handler)
    }
  },
  getAppThemeSettings: (): Promise<AppThemeSettings> => {
    return invokeIpc("settings:getAppThemeSettings")
  },
  setAppThemeSettings: (updates: Partial<AppThemeSettings>): Promise<AppThemeSettings> => {
    return invokeIpc("settings:setAppThemeSettings", updates)
  },
  onAppThemeSettingsChanged: (callback: (settings: AppThemeSettings) => void): (() => void) => {
    const handler = (_event: unknown, settings: AppThemeSettings): void => {
      callback(settings)
    }

    ipcRenderer.on("settings:appThemeSettingsChanged", handler)
    return () => {
      ipcRenderer.removeListener("settings:appThemeSettingsChanged", handler)
    }
  },
  getLauncherSettings: (): Promise<LauncherSettings> => {
    return invokeIpc("settings:getLauncherSettings")
  },
  setLauncherSettings: (updates: Partial<LauncherSettings>): Promise<LauncherSettings> => {
    return invokeIpc("settings:setLauncherSettings", updates)
  },
  openWindow: (payload?: SettingsWindowNavigationPayload): Promise<void> => {
    return invokeIpc("settings:openWindow", payload)
  },
  openTab: (payload: SettingsWindowNavigationPayload): Promise<void> => {
    return invokeIpc("settings:openTab", payload)
  },
  getPendingNavigation: (): Promise<SettingsWindowNavigationPayload | null> => {
    return invokeIpc("settings:getPendingNavigation")
  }
}
