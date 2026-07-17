import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import {
  settingsWindowGetPendingNavigationArgsSchema,
  settingsWindowOpenArgsSchema,
  settingsWindowOpenTabArgsSchema
} from "@shared/settings-window"
import { registerValidatedIpcHandle } from "../ipc/handle"
import { getWindowIdentity, isDurableWindowIdentity } from "../windows/window-identity"
import { SettingsWindowRoutingService } from "./service"

type SenderWindowResolver = (sender: WebContents) => BrowserWindow | null

function resolveElectronSenderWindow(sender: WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(sender)
}

export class SettingsWindowRoutingController {
  constructor(
    private readonly settingsWindowRoutingService: SettingsWindowRoutingService,
    private readonly resolveSenderWindow: SenderWindowResolver = resolveElectronSenderWindow
  ) {}

  register(ipcMain: IpcMain): void {
    registerValidatedIpcHandle(
      ipcMain,
      "settings:openWindow",
      settingsWindowOpenArgsSchema,
      (event, ...args) => {
        const hideLauncher = this.assertSettingsOpener(event)
        this.settingsWindowRoutingService.openWindow(args[0])
        if (hideLauncher) this.hideLauncherSender(event)
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "settings:openTab",
      settingsWindowOpenTabArgsSchema,
      (event, payload) => {
        const hideLauncher = this.assertSettingsOpener(event)
        this.settingsWindowRoutingService.openWindow(payload)
        if (hideLauncher) this.hideLauncherSender(event)
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
      getWindowIdentity(event.sender)?.kind !== "settings" ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      throw new Error("Pending settings navigation can only be claimed by the Settings window.")
    }
  }

  private assertSettingsOpener(event: IpcMainInvokeEvent): boolean {
    const identity = getWindowIdentity(event.sender)
    if (
      event.senderFrame !== event.sender.mainFrame ||
      (identity?.kind !== "launcher" && !isDurableWindowIdentity(identity))
    ) {
      throw new Error("Settings can only be opened by the Launcher or a durable window.")
    }
    return identity.kind === "launcher"
  }

  private hideLauncherSender(event: IpcMainInvokeEvent): void {
    this.resolveSenderWindow(event.sender)?.hide()
  }
}
