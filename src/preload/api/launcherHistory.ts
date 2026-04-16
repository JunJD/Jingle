import { ipcRenderer } from "electron"
import type { LauncherHistoryItem } from "../../shared/launcher-history"

export const launcherHistoryApi = {
  list: (): Promise<LauncherHistoryItem[]> => {
    return ipcRenderer.invoke("launcherHistory:list")
  },
  remove: (itemId: string): Promise<void> => {
    return ipcRenderer.invoke("launcherHistory:remove", itemId)
  },
  setPinned: (itemId: string, pin: boolean): Promise<LauncherHistoryItem> => {
    return ipcRenderer.invoke("launcherHistory:setPinned", itemId, pin)
  }
}
