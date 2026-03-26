import type { IpcMain } from "electron"
import {
  listLauncherHistoryItems,
  removeLauncherHistoryItem,
  setLauncherHistoryPinned
} from "../services/launcher-history"

export function registerLauncherHistoryHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("launcherHistory:list", () => {
    return listLauncherHistoryItems()
  })

  ipcMain.handle("launcherHistory:remove", (_event, itemId: string) => {
    removeLauncherHistoryItem(itemId)
  })

  ipcMain.handle("launcherHistory:setPinned", (_event, itemId: string, pin: boolean) => {
    return setLauncherHistoryPinned(itemId, pin)
  })
}
