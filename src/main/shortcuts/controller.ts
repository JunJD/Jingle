import type { IpcMain } from "electron"
import type { ShortcutSettings } from "../../shared/shortcuts/settings"
import { ShortcutsService } from "./service"

export class ShortcutsController {
  constructor(private readonly shortcutsService: ShortcutsService) {}

  register(params: { applySettings: () => void; ipcMain: IpcMain }): void {
    const { applySettings, ipcMain } = params

    ipcMain.on("shortcuts:getBootstrapSettingsSync", (event) => {
      event.returnValue = this.shortcutsService.getBootstrapSettings()
    })

    ipcMain.handle("shortcuts:getSettings", () => {
      return this.shortcutsService.getSettings()
    })

    ipcMain.handle("shortcuts:setSettings", (_event, updates: Partial<ShortcutSettings>) => {
      return this.shortcutsService.setSettings(updates, { applySettings })
    })

    ipcMain.handle("shortcuts:getResolvedBindings", () => {
      return this.shortcutsService.getResolvedBindings()
    })

    ipcMain.handle("shortcuts:getGlobalAvailability", () => {
      return this.shortcutsService.getGlobalAvailability()
    })
  }
}
