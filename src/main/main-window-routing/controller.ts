import type { IpcMain } from "electron"
import type { MainWindowNavigationPayload } from "../../shared/main-window"
import { registerIpcHandle } from "../ipc/handle"
import { MainWindowRoutingService } from "./service"

export class MainWindowRoutingController {
  constructor(private readonly mainWindowRoutingService: MainWindowRoutingService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "main-window:openWindow", (_event, payload?: MainWindowNavigationPayload) => {
      this.mainWindowRoutingService.openWindow(payload)
    })

    registerIpcHandle(ipcMain, "main-window:openThread", (_event, threadId: string) => {
      this.mainWindowRoutingService.openThread(threadId)
    })

    registerIpcHandle(ipcMain, "main-window:getPendingNavigation", () => {
      return this.mainWindowRoutingService.getPendingNavigation()
    })

    registerIpcHandle(ipcMain, "main-window:ackNavigation", (_event, payload: MainWindowNavigationPayload) => {
      this.mainWindowRoutingService.acknowledgeNavigation(payload)
    })
  }
}
