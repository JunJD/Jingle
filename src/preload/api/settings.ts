import { ipcRenderer } from "electron"
import type { AgentConfig } from "@shared/app-types"
import type { AppThemeSettings } from "@shared/app-theme"
import type { LauncherSettings } from "@shared/launcher-settings"
import {
  SETTINGS_NAVIGATION_CHANGED_CHANNEL,
  settingsWindowNavigationPayloadSchema,
  type SettingsWindowNavigationPayload
} from "@shared/settings-window"
import { invokeIpc } from "../ipc"

let pendingNavigationClaim: Promise<SettingsWindowNavigationPayload | null> | null = null
let pendingNavigationClaimSettled = false
let navigationDeliveryGeneration = 0

function claimPendingNavigation(): Promise<SettingsWindowNavigationPayload | null> {
  if (pendingNavigationClaimSettled) {
    return Promise.resolve(null)
  }

  if (!pendingNavigationClaim) {
    const claimGeneration = navigationDeliveryGeneration
    pendingNavigationClaim = invokeIpc<unknown>("settings:getPendingNavigation")
      .then((payload) => {
        const parsedPayload =
          payload === null ? null : settingsWindowNavigationPayloadSchema.parse(payload)
        pendingNavigationClaimSettled = true
        if (navigationDeliveryGeneration !== claimGeneration) {
          return null
        }

        return parsedPayload
      })
      .catch((error: unknown) => {
        // Retrying can recover a pre-consume transport failure. A claim already
        // consumed by main resolves to null on retry, so navigation is never replayed.
        pendingNavigationClaim = null
        pendingNavigationClaimSettled = false
        throw error
      })
  }

  return pendingNavigationClaim
}

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
    return payload ? invokeIpc("settings:openWindow", payload) : invokeIpc("settings:openWindow")
  },
  openTab: (payload: SettingsWindowNavigationPayload): Promise<void> => {
    return invokeIpc("settings:openTab", payload)
  },
  getPendingNavigation: (): Promise<SettingsWindowNavigationPayload | null> => {
    return claimPendingNavigation()
  },
  onNavigationChanged: (
    callback: (payload: SettingsWindowNavigationPayload) => void
  ): (() => void) => {
    const handler = (_event: unknown, payload: unknown): void => {
      navigationDeliveryGeneration += 1
      callback(settingsWindowNavigationPayloadSchema.parse(payload))
    }

    ipcRenderer.on(SETTINGS_NAVIGATION_CHANGED_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(SETTINGS_NAVIGATION_CHANGED_CHANNEL, handler)
    }
  }
}
