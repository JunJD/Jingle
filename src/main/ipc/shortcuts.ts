import { BrowserWindow, type IpcMain } from "electron"
import { resolveShortcutPlatform } from "../../shared/shortcuts/model"
import { resolveShortcutBindings, type ShortcutSettings } from "../../shared/shortcuts/settings"
import { getShortcutSettings, setShortcutSettings } from "../preferences"
import { getGlobalShortcutAvailability } from "../services/shortcuts/global-shortcut-service"

function emitShortcutSettingsChanged(settings: ShortcutSettings): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("shortcuts:settingsChanged", settings)
    }
  }
}

export function registerShortcutHandlers(params: {
  applySettings: () => void
  ipcMain: IpcMain
}): void {
  const { applySettings, ipcMain } = params

  ipcMain.on("shortcuts:getBootstrapSettingsSync", (event) => {
    event.returnValue = getShortcutSettings()
  })

  ipcMain.handle("shortcuts:getSettings", () => {
    return getShortcutSettings()
  })

  ipcMain.handle("shortcuts:setSettings", (_event, updates: Partial<ShortcutSettings>) => {
    const settings = setShortcutSettings(updates)
    applySettings()
    emitShortcutSettingsChanged(settings)
    return settings
  })

  ipcMain.handle("shortcuts:getResolvedBindings", () => {
    return resolveShortcutBindings(getShortcutSettings(), resolveShortcutPlatform(process.platform))
  })

  ipcMain.handle("shortcuts:getGlobalAvailability", () => {
    return getGlobalShortcutAvailability()
  })
}
