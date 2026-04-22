import type { AgentConfig } from "@shared/app-types"
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
