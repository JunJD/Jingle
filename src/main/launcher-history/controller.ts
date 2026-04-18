import type { IpcMain } from "electron"
import { LauncherHistoryService } from "./service"

export class LauncherHistoryController {
  constructor(private readonly launcherHistoryService: LauncherHistoryService) {}

  register(ipcMain: IpcMain): void {
    ipcMain.handle("launcherHistory:list", () => {
      return this.launcherHistoryService.listItems()
    })

    ipcMain.handle("launcherHistory:remove", (_event, itemId: string) => {
      this.launcherHistoryService.removeItem(itemId)
    })

    ipcMain.handle("launcherHistory:setPinned", (_event, itemId: string, pin: boolean) => {
      return this.launcherHistoryService.setItemPinned(itemId, pin)
    })
  }
}
