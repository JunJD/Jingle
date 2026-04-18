import type { IpcMain } from "electron"
import type { MainWindowNavigationPayload } from "../../shared/main-window"
import { MainWindowRoutingService } from "./service"

export class MainWindowRoutingController {
  constructor(private readonly mainWindowRoutingService: MainWindowRoutingService) {}

  register(ipcMain: IpcMain): void {
    ipcMain.handle("main-window:openWindow", (_event, payload?: MainWindowNavigationPayload) => {
      this.mainWindowRoutingService.openWindow(payload)
    })

    ipcMain.handle("main-window:openThread", (_event, threadId: string) => {
      this.mainWindowRoutingService.openThread(threadId)
    })

    ipcMain.handle("main-window:getPendingNavigation", () => {
      return this.mainWindowRoutingService.getPendingNavigation()
    })

    ipcMain.handle("main-window:ackNavigation", (_event, payload: MainWindowNavigationPayload) => {
      this.mainWindowRoutingService.acknowledgeNavigation(payload)
    })
  }
}
