import { BrowserWindow } from "electron"
import type { AppThemeSettings } from "@shared/app-theme"
import type { LauncherSettings } from "@shared/launcher-settings"
import type { AgentConfig } from "../types"
import {
  getAgentConfig,
  getAppThemeSettings,
  getLauncherSettings,
  setAgentConfig,
  setAppThemeSettings,
  setLauncherSettings
} from "../preferences"

export class SettingsService {
  getAgentConfig(): AgentConfig {
    return getAgentConfig()
  }

  setAgentConfig(updates: Partial<AgentConfig>): AgentConfig {
    const config = setAgentConfig(updates)
    this.emitAgentConfigChanged(config)
    return config
  }

  getAppThemeSettings(): AppThemeSettings {
    return getAppThemeSettings()
  }

  setAppThemeSettings(updates: Partial<AppThemeSettings>): AppThemeSettings {
    const settings = setAppThemeSettings(updates)
    this.emitAppThemeSettingsChanged(settings)
    return settings
  }

  getLauncherSettings(): LauncherSettings {
    return getLauncherSettings()
  }

  setLauncherSettings(updates: Partial<LauncherSettings>): LauncherSettings {
    return setLauncherSettings(updates)
  }

  private emitAppThemeSettingsChanged(settings: AppThemeSettings): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("settings:appThemeSettingsChanged", settings)
      }
    }
  }

  private emitAgentConfigChanged(config: AgentConfig): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("settings:agentConfigChanged", config)
      }
    }
  }
}
