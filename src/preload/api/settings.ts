import { ipcRenderer } from "electron"
import type { AgentConfig } from "../../shared/app-types"
import type { LauncherSettings } from "../../shared/launcher-settings"
import type { SettingsWindowNavigationPayload } from "../../shared/settings-window"

export const settingsApi = {
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
}
