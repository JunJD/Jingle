import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from "electron"
import type { SettingsWindowNavigationPayload } from "@shared/settings-window"
import { registerIpcHandle } from "../ipc/handle"
import { SettingsWindowRoutingService } from "./service"

export class SettingsWindowRoutingController {
  constructor(private readonly settingsWindowRoutingService: SettingsWindowRoutingService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "settings:openWindow", (event, payload?: SettingsWindowNavigationPayload) => {
      this.settingsWindowRoutingService.openWindow(payload)
      this.hideLauncherSender(event)
    })

    registerIpcHandle(ipcMain, "settings:openTab", (event, payload: SettingsWindowNavigationPayload) => {
      this.settingsWindowRoutingService.openWindow(payload)
      this.hideLauncherSender(event)
    })

    registerIpcHandle(ipcMain, "settings:getPendingNavigation", () => {
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
