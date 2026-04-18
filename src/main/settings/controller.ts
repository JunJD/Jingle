import type { IpcMain } from "electron"
import type { LauncherSettings } from "../../shared/launcher-settings"
import type { AgentConfig } from "../types"
import { SettingsService } from "./service"

export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  register(ipcMain: IpcMain): void {
    ipcMain.handle("settings:getAgentConfig", async () => {
      return this.settingsService.getAgentConfig()
    })

    ipcMain.handle("settings:setAgentConfig", async (_event, updates: Partial<AgentConfig>) => {
      return this.settingsService.setAgentConfig(updates)
    })

    ipcMain.handle("settings:getLauncherSettings", async () => {
      return this.settingsService.getLauncherSettings()
    })

    ipcMain.handle(
      "settings:setLauncherSettings",
      async (_event, updates: Partial<LauncherSettings>) => {
        return this.settingsService.setLauncherSettings(updates)
      }
    )
  }
}
