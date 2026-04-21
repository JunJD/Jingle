import type { IpcMain } from "electron"
import type { LauncherSettings } from "@shared/launcher-settings"
import type { AgentConfig } from "../types"
import { registerIpcHandle } from "../ipc/handle"
import { SettingsService } from "./service"

export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "settings:getAgentConfig", async () => {
      return this.settingsService.getAgentConfig()
    })

    registerIpcHandle(ipcMain, "settings:setAgentConfig", async (_event, updates: Partial<AgentConfig>) => {
      return this.settingsService.setAgentConfig(updates)
    })

    registerIpcHandle(ipcMain, "settings:getLauncherSettings", async () => {
      return this.settingsService.getLauncherSettings()
    })

    registerIpcHandle(
      ipcMain,
      "settings:setLauncherSettings",
      async (_event, updates: Partial<LauncherSettings>) => {
        return this.settingsService.setLauncherSettings(updates)
      }
    )
  }
}
