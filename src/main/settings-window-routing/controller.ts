import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from "electron"
import {
  settingsWindowGetPendingNavigationArgsSchema,
  settingsWindowOpenArgsSchema,
  settingsWindowOpenTabArgsSchema
} from "@shared/settings-window"
import { registerValidatedIpcHandle } from "../ipc/handle"
import { isSettingsWindowWebContents } from "../windows/settings-window"
import { SettingsWindowRoutingService } from "./service"

export class SettingsWindowRoutingController {
  constructor(private readonly settingsWindowRoutingService: SettingsWindowRoutingService) {}

  register(ipcMain: IpcMain): void {
    registerValidatedIpcHandle(
      ipcMain,
      "settings:openWindow",
      settingsWindowOpenArgsSchema,
      (event, ...args) => {
        this.settingsWindowRoutingService.openWindow(args[0])
        this.hideLauncherSender(event)
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "settings:openTab",
      settingsWindowOpenTabArgsSchema,
      (event, payload) => {
        this.settingsWindowRoutingService.openWindow(payload)
        this.hideLauncherSender(event)
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "settings:getPendingNavigation",
      settingsWindowGetPendingNavigationArgsSchema,
      (event) => {
        this.assertSettingsSender(event)
        return this.settingsWindowRoutingService.getPendingNavigation()
      }
    )
  }

  private assertSettingsSender(event: IpcMainInvokeEvent): void {
    if (
      !isSettingsWindowWebContents(event.sender) ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      throw new Error("Pending settings navigation can only be claimed by the Settings window.")
    }
  }

  private hideLauncherSender(event: IpcMainInvokeEvent): void {
    const senderUrl = new URL(event.sender.getURL())
    if (senderUrl.searchParams.get("window") !== "launcher") {
      return
    }

    BrowserWindow.fromWebContents(event.sender)?.hide()
  }
}
