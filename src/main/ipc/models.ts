import { IpcMain, app } from "electron"
import type { AgentConfig } from "../types"
import type { LauncherSettings } from "../../shared/launcher-settings"
import {
  getAgentConfig,
  getLauncherSettings,
  setAgentConfig,
  setLauncherSettings
} from "../preferences"

export function registerModelHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("settings:getAgentConfig", async () => {
    return getAgentConfig()
  })

  ipcMain.handle("settings:setAgentConfig", async (_event, updates: Partial<AgentConfig>) => {
    return setAgentConfig(updates)
  })

  ipcMain.handle("settings:getLauncherSettings", async () => {
    return getLauncherSettings()
  })

  ipcMain.handle(
    "settings:setLauncherSettings",
    async (_event, updates: Partial<LauncherSettings>) => {
      return setLauncherSettings(updates)
    }
  )

  // Sync version info
  ipcMain.on("app:version", (event) => {
    event.returnValue = app.getVersion()
  })
}
