import type { IpcMain } from "electron"
import type { SettingsWindowNavigationPayload } from "../../shared/settings-window"

export function registerSettingsWindowHandlers(params: {
  consumePendingNavigation: () => SettingsWindowNavigationPayload | null
  ipcMain: IpcMain
  openSettingsWindow: (payload?: SettingsWindowNavigationPayload) => void
}): void {
  const { consumePendingNavigation, ipcMain, openSettingsWindow } = params

  ipcMain.handle("settings:openWindow", (_event, payload?: SettingsWindowNavigationPayload) => {
    openSettingsWindow(payload)
  })

  ipcMain.handle("settings:openTab", (_event, payload: SettingsWindowNavigationPayload) => {
    openSettingsWindow(payload)
  })

  ipcMain.handle("settings:getPendingNavigation", () => {
    return consumePendingNavigation()
  })
}
