import type { LauncherHistoryItem } from "@shared/launcher-history"
import { invokeIpc } from "../ipc"

export const launcherHistoryApi = {
  list: (): Promise<LauncherHistoryItem[]> => {
    return invokeIpc("launcherHistory:list")
  },
  remove: (itemId: string): Promise<void> => {
    return invokeIpc("launcherHistory:remove", itemId)
  },
  setPinned: (itemId: string, pin: boolean): Promise<LauncherHistoryItem> => {
    return invokeIpc("launcherHistory:setPinned", itemId, pin)
  }
}
