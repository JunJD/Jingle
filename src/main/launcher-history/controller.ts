import type { IpcMain } from "electron"
import { registerIpcHandle } from "../ipc/handle"
import { LauncherHistoryService } from "./service"

export class LauncherHistoryController {
  constructor(private readonly launcherHistoryService: LauncherHistoryService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "launcherHistory:list", () => {
      return this.launcherHistoryService.listItems()
    })

    registerIpcHandle(ipcMain, "launcherHistory:remove", (_event, itemId: string) => {
      this.launcherHistoryService.removeItem(itemId)
    })

    registerIpcHandle(ipcMain, "launcherHistory:setPinned", (_event, itemId: string, pin: boolean) => {
      return this.launcherHistoryService.setItemPinned(itemId, pin)
    })
  }
}
