import { ipcRenderer } from "electron"
import type { AgentConfig } from "@shared/app-types"
import {
  computerUseSettingsRuntimeStatusSchema,
  type AgentConfigUpdateResult,
  type ComputerUseSettingsRuntimeStatus
} from "@shared/computer-use-settings"
import type { AppThemeSettings } from "@shared/app-theme"
import type { LauncherSettings } from "@shared/launcher-settings"
import {
  createSettingsWindowNavigationAcknowledgement,
  SETTINGS_NAVIGATION_CHANGED_CHANNEL,
  settingsWindowNavigationDeliverySchema,
  type SettingsWindowNavigationDelivery,
  type SettingsWindowNavigationPayload
} from "@shared/settings-window"
import { invokeIpc } from "../ipc"

let pendingNavigationClaim: Promise<SettingsWindowNavigationDelivery | null> | null = null
let pendingNavigationClaimSettled = false
let navigationDeliveryGeneration = 0

function claimPendingNavigation(): Promise<SettingsWindowNavigationDelivery | null> {
  if (pendingNavigationClaimSettled) {
    return Promise.resolve(null)
  }

  if (!pendingNavigationClaim) {
    const claimGeneration = navigationDeliveryGeneration
    pendingNavigationClaim = invokeIpc<unknown>("settings:getPendingNavigation")
      .then((payload) => {
        const parsedDelivery =
          payload === null ? null : settingsWindowNavigationDeliverySchema.parse(payload)
        pendingNavigationClaimSettled = true
        if (navigationDeliveryGeneration !== claimGeneration) {
          return null
        }

        return parsedDelivery
      })
      .catch((error: unknown) => {
        // Main retains an unacknowledged delivery, so retrying cannot lose a
        // navigation even if the first response was interrupted by a reload.
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
  getComputerUseRuntimeStatus: (): Promise<ComputerUseSettingsRuntimeStatus> => {
    return invokeIpc<unknown>("settings:getComputerUseRuntimeStatus").then((result) =>
      computerUseSettingsRuntimeStatusSchema.parse(result)
    )
  },
  setAgentConfig: (updates: Partial<AgentConfig>): Promise<AgentConfigUpdateResult> => {
    return invokeIpc<AgentConfigUpdateResult>("settings:setAgentConfig", updates).then(
      (result) => ({
        config: result.config,
        computerUseRuntime: computerUseSettingsRuntimeStatusSchema.parse(result.computerUseRuntime)
      })
    )
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
  getPendingNavigation: (): Promise<SettingsWindowNavigationDelivery | null> => {
    return claimPendingNavigation()
  },
  acknowledgeNavigation: (delivery: SettingsWindowNavigationDelivery): Promise<void> => {
    return invokeIpc(
      "settings:acknowledgeNavigation",
      createSettingsWindowNavigationAcknowledgement(delivery)
    )
  },
  onNavigationChanged: (
    callback: (delivery: SettingsWindowNavigationDelivery) => void
  ): (() => void) => {
    const handler = (_event: unknown, delivery: unknown): void => {
      navigationDeliveryGeneration += 1
      callback(settingsWindowNavigationDeliverySchema.parse(delivery))
    }

    ipcRenderer.on(SETTINGS_NAVIGATION_CHANGED_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(SETTINGS_NAVIGATION_CHANGED_CHANNEL, handler)
    }
  }
}
