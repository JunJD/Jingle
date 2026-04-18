import type { LauncherSettings } from "../../shared/launcher-settings"
import type { AgentConfig } from "../types"
import {
  getAgentConfig,
  getLauncherSettings,
  setAgentConfig,
  setLauncherSettings
} from "../preferences"

export class SettingsService {
  getAgentConfig(): AgentConfig {
    return getAgentConfig()
  }

  setAgentConfig(updates: Partial<AgentConfig>): AgentConfig {
    return setAgentConfig(updates)
  }

  getLauncherSettings(): LauncherSettings {
    return getLauncherSettings()
  }

  setLauncherSettings(updates: Partial<LauncherSettings>): LauncherSettings {
    return setLauncherSettings(updates)
  }
}
