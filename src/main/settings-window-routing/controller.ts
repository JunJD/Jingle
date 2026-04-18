import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from "electron"
import type { SettingsWindowNavigationPayload } from "../../shared/settings-window"
import { SettingsWindowRoutingService } from "./service"

export class SettingsWindowRoutingController {
  constructor(private readonly settingsWindowRoutingService: SettingsWindowRoutingService) {}

  register(ipcMain: IpcMain): void {
    ipcMain.handle("settings:openWindow", (event, payload?: SettingsWindowNavigationPayload) => {
      this.settingsWindowRoutingService.openWindow(payload)
      this.hideLauncherSender(event)
    })

    ipcMain.handle("settings:openTab", (event, payload: SettingsWindowNavigationPayload) => {
      this.settingsWindowRoutingService.openWindow(payload)
      this.hideLauncherSender(event)
    })

    ipcMain.handle("settings:getPendingNavigation", () => {
      return this.settingsWindowRoutingService.getPendingNavigation()
    })
  }

  private hideLauncherSender(event: IpcMainInvokeEvent): void {
    const senderUrl = new URL(event.sender.getURL())
    if (senderUrl.searchParams.get("window") !== "launcher") {
      return
    }

    BrowserWindow.fromWebContents(event.sender)?.hide()
  }
}
