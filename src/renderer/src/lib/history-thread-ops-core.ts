import type { Thread } from "@shared/app-types"
import type { HistoryShellState } from "./history-shell-store-core"

type HistoryThreadOpsState = Pick<
  HistoryShellState,
  "currentThreadId" | "loadThreads" | "selectThread" | "threads"
>

export interface HistoryThreadOpsStore {
  getState: () => HistoryThreadOpsState
}

async function ensureHistoryThread(
  store: HistoryThreadOpsStore,
  threadId: string
): Promise<boolean> {
  if (store.getState().threads.some((candidate) => candidate.thread_id === threadId)) {
    return true
  }

  await store.getState().loadThreads()
  return store.getState().threads.some((candidate) => candidate.thread_id === threadId)
}

export function createHistoryThreadOps(store: HistoryThreadOpsStore) {
  const loadHistoryThreads = async (): Promise<Thread[]> => {
    await store.getState().loadThreads()
    return store.getState().threads
  }

  const getCurrentHistoryThreadId = (): string | null => {
    return store.getState().currentThreadId
  }

  const activateHistoryThread = async (
    threadId: string,
    reloadThread: (threadId: string) => Promise<void>
  ): Promise<boolean> => {
    const matched = await ensureHistoryThread(store, threadId)
    if (!matched) {
      return false
    }

    await store.getState().selectThread(threadId)
    await reloadThread(threadId)
    return true
  }

  const openHistoryThread = async (
    threadId: string,
    reloadThread: (threadId: string) => Promise<void>
  ): Promise<boolean> => {
    return activateHistoryThread(threadId, reloadThread)
  }

  const refreshHistoryThreadsAndReloadActive = async (
    reloadThread: (threadId: string) => Promise<void>
  ): Promise<Thread[]> => {
    const threads = await loadHistoryThreads()
    const activeThreadId = getCurrentHistoryThreadId()
    if (activeThreadId) {
      await reloadThread(activeThreadId)
    }

    return threads
  }

  return {
    activateHistoryThread,
    getCurrentHistoryThreadId,
    loadHistoryThreads,
    openHistoryThread,
    refreshHistoryThreadsAndReloadActive
  }
}
