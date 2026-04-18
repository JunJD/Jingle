import type { Thread } from "@/types"
import { useHistoryShellStore } from "./history-shell-store"

export async function loadHistoryThreads(): Promise<Thread[]> {
  await useHistoryShellStore.getState().loadThreads()
  return useHistoryShellStore.getState().threads
}

export function getCurrentHistoryThreadId(): string | null {
  return useHistoryShellStore.getState().currentThreadId
}

export async function activateHistoryThread(
  threadId: string,
  reloadThread: (threadId: string) => Promise<void>
): Promise<void> {
  const threads = useHistoryShellStore.getState().threads
  if (!threads.some((candidate) => candidate.thread_id === threadId)) {
    await useHistoryShellStore.getState().loadThreads()
  }

  await useHistoryShellStore.getState().selectThread(threadId)
  await reloadThread(threadId)
}

export async function openHistoryThread(
  threadId: string,
  reloadThread: (threadId: string) => Promise<void>
): Promise<boolean> {
  const thread = await window.api.threads.get(threadId)
  if (!thread) {
    return false
  }

  await activateHistoryThread(threadId, reloadThread)
  return true
}

export async function refreshHistoryThreadsAndReloadActive(
  reloadThread: (threadId: string) => Promise<void>
): Promise<Thread[]> {
  const threads = await loadHistoryThreads()
  const activeThreadId = getCurrentHistoryThreadId()
  if (activeThreadId) {
    await reloadThread(activeThreadId)
  }

  return threads
}
