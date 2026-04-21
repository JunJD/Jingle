import type { IpcMain } from "electron"
import type { ShortcutSettings } from "../../shared/shortcuts/settings"
import { registerIpcHandle } from "../ipc/handle"
import { ShortcutsService } from "./service"

export class ShortcutsController {
  constructor(private readonly shortcutsService: ShortcutsService) {}

  register(params: { applySettings: () => void; ipcMain: IpcMain }): void {
    const { applySettings, ipcMain } = params

    ipcMain.on("shortcuts:getBootstrapSettingsSync", (event) => {
      event.returnValue = this.shortcutsService.getBootstrapSettings()
    })

    registerIpcHandle(ipcMain, "shortcuts:getSettings", () => {
      return this.shortcutsService.getSettings()
    })

    registerIpcHandle(ipcMain, "shortcuts:setSettings", (_event, updates: Partial<ShortcutSettings>) => {
      return this.shortcutsService.setSettings(updates, { applySettings })
    })

    registerIpcHandle(ipcMain, "shortcuts:getResolvedBindings", () => {
      return this.shortcutsService.getResolvedBindings()
    })

    registerIpcHandle(ipcMain, "shortcuts:getGlobalAvailability", () => {
      return this.shortcutsService.getGlobalAvailability()
    })
  }
}
