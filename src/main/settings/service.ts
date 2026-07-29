import { BrowserWindow } from "electron"
import type { AppThemeSettings } from "@shared/app-theme"
import type { LauncherSettings } from "@shared/launcher-settings"
import type { AgentConfig } from "../types"
import {
  COMPUTER_USE_SETTINGS_APPLY_FAILED_DIAGNOSTIC_CODE,
  type AgentConfigUpdateResult,
  type ComputerUseSettingsRuntimeStatus
} from "@shared/computer-use-settings"
import {
  getAgentConfig,
  getAppThemeSettings,
  getLauncherSettings,
  setAgentConfig,
  setAppThemeSettings,
  setLauncherSettings
} from "../preferences"
import { updateThemeTitleBarOverlay } from "../windows/title-bar-overlay"
import { getWindowIdentity, isDurableWindowIdentity } from "../windows/window-identity"
import { ComputerUseRuntime } from "../computer-use/runtime"
import { diagnosticsGraph } from "../diagnostics/instance"

export class SettingsService {
  constructor(private readonly computerUseRuntime: ComputerUseRuntime) {}

  getAgentConfig(): AgentConfig {
    return getAgentConfig()
  }

  getComputerUseRuntimeStatus(): ComputerUseSettingsRuntimeStatus {
    return this.computerUseRuntime.getConfigApplicationStatus()
  }

  async setAgentConfig(updates: Partial<AgentConfig>): Promise<AgentConfigUpdateResult> {
    const config = setAgentConfig(updates)
    try {
      await this.computerUseRuntime.applyAgentConfig(config)
    } catch (error) {
      if (this.computerUseRuntime.getConfigApplicationStatus().state === "retry_required") {
        diagnosticsGraph.capture({
          component: "settings-service",
          dimensionEntries: [{ key: "errorType", value: readDiagnosticErrorType(error) }],
          eventCode: COMPUTER_USE_SETTINGS_APPLY_FAILED_DIAGNOSTIC_CODE,
          fingerprint: COMPUTER_USE_SETTINGS_APPLY_FAILED_DIAGNOSTIC_CODE,
          level: "error",
          operation: "apply-computer-use-settings",
          recoverable: true,
          stateImpact: "desired-settings-persisted-runtime-apply-retry-required",
          summary: "Computer Use settings were saved but could not be applied to the live runtime."
        })
      }
    } finally {
      this.emitAgentConfigChanged(getAgentConfig())
    }
    return {
      config: getAgentConfig(),
      computerUseRuntime: this.computerUseRuntime.getConfigApplicationStatus()
    }
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
      if (window.isDestroyed()) {
        continue
      }

      const identity = getWindowIdentity(window.webContents)
      const hasThemeAwareNativeChrome =
        identity?.kind === "settings" || isDurableWindowIdentity(identity)

      if (hasThemeAwareNativeChrome) {
        try {
          window.setBackgroundColor(settings.config.theme.surface)
          if (process.platform !== "darwin") {
            updateThemeTitleBarOverlay(window, settings)
          }
        } catch (error) {
          console.warn("[Settings] Failed to update the native window theme.", error)
        }
      }

      window.webContents.send("settings:appThemeSettingsChanged", settings)
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

function readDiagnosticErrorType(error: unknown): string {
  if (!(error instanceof Error)) return "unknown"
  const name = error.name.trim()
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ? name : "Error"
}
