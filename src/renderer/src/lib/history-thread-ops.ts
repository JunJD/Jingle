import { historyShellStore } from "./history-shell-store"
import { createHistoryThreadOps } from "./history-thread-ops-core"

export const {
  activateHistoryThread,
  getCurrentHistoryThreadId,
  loadHistoryThreads,
  openHistoryThread,
  refreshHistoryThreadsAndReloadActive
} = createHistoryThreadOps(historyShellStore)
