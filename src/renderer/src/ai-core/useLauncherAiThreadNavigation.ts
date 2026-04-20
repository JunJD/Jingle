import { useCallback, useEffect, useState } from "react"
import { AI_THREAD_SOURCE } from "@shared/launcher-ai"
import type { Thread } from "@/types"
import { useThreadContext } from "@/lib/thread-context"
import type { AiCoreThreadCreateInput, AiCoreThreadHandle } from "./AiCoreHost"
import { useAiCoreThreads } from "./AiCoreHost"
import { shouldReloadLauncherAiThreadOnFocus } from "./launcher-ai-thread-navigation-core"

interface UseLauncherAiThreadNavigationOptions {
  initialAction: "focus" | "submit"
  seedQuery: string
}

export interface LauncherAiThreadNavigation {
  branchThread: (threadId: string) => Promise<AiCoreThreadHandle>
  canGoToNextThread: boolean
  canGoToPreviousThread: boolean
  createThread: (input: AiCoreThreadCreateInput) => Promise<AiCoreThreadHandle>
  goToNextThread: () => Promise<string | null>
  goToPreviousThread: () => Promise<string | null>
  threadId: string | null
}

interface AdjacentThreadIds {
  next: string | null
  previous: string | null
}

function isLauncherAiThread(thread: Thread): boolean {
  return thread.metadata?.source === AI_THREAD_SOURCE
}

function listLauncherAiThreadsByRecency(threads: readonly Thread[]): Thread[] {
  return threads
    .filter(isLauncherAiThread)
    .sort((left, right) => right.updated_at.getTime() - left.updated_at.getTime())
}

function getAdjacentThreadIds(
  threads: readonly Thread[],
  activeThreadId: string | null
): AdjacentThreadIds {
  if (!activeThreadId) {
    return {
      next: null,
      previous: null
    }
  }

  const activeIndex = threads.findIndex((thread) => thread.thread_id === activeThreadId)
  if (activeIndex < 0) {
    return {
      next: null,
      previous: null
    }
  }

  return {
    next: threads[activeIndex - 1]?.thread_id ?? null,
    previous: threads[activeIndex + 1]?.thread_id ?? null
  }
}

export function useLauncherAiThreadNavigation(
  options: UseLauncherAiThreadNavigationOptions
): LauncherAiThreadNavigation {
  const { initialAction, seedQuery } = options
  const threadHost = useAiCoreThreads()
  const threadContext = useThreadContext()
  const [threadId, setThreadId] = useState<string | null>(null)
  const [adjacentThreadIds, setAdjacentThreadIds] = useState<AdjacentThreadIds>({
    next: null,
    previous: null
  })
  const shouldStartFreshThread = initialAction === "submit" && seedQuery.trim().length > 0

  const listAiThreads = useCallback(async (): Promise<Thread[]> => {
    return listLauncherAiThreadsByRecency(await threadHost.list())
  }, [threadHost])
  const resolveActiveThreadId = useCallback((): string | null => {
    return threadHost.getActiveThreadId() ?? threadId
  }, [threadHost, threadId])
  const refreshAdjacentThreadIds = useCallback(
    async (activeThreadId: string | null): Promise<void> => {
      const threads = await listAiThreads()
      setAdjacentThreadIds(getAdjacentThreadIds(threads, activeThreadId))
    },
    [listAiThreads]
  )
  const activateThread = useCallback(
    async (nextThreadId: string): Promise<void> => {
      await threadHost.activate(nextThreadId)
      setThreadId(nextThreadId)
      await refreshAdjacentThreadIds(nextThreadId)
    },
    [refreshAdjacentThreadIds, threadHost]
  )
  const createThread = useCallback(
    async (input: AiCoreThreadCreateInput): Promise<AiCoreThreadHandle> => {
      const createdThread = await threadHost.create(input)
      await activateThread(createdThread.threadId)
      return createdThread
    },
    [activateThread, threadHost]
  )
  const branchThread = useCallback(
    async (sourceThreadId: string): Promise<AiCoreThreadHandle> => {
      const branchedThread = await threadHost.clone(sourceThreadId)
      await activateThread(branchedThread.threadId)
      return branchedThread
    },
    [activateThread, threadHost]
  )
  const goToAdjacentThread = useCallback(
    async (direction: keyof AdjacentThreadIds): Promise<string | null> => {
      const threads = await listAiThreads()
      const activeThreadId = resolveActiveThreadId()
      const adjacentThreadId = getAdjacentThreadIds(threads, activeThreadId)[direction]
      if (!adjacentThreadId) {
        setAdjacentThreadIds(getAdjacentThreadIds(threads, activeThreadId))
        return null
      }

      await activateThread(adjacentThreadId)
      return adjacentThreadId
    },
    [activateThread, listAiThreads, resolveActiveThreadId]
  )
  const goToPreviousThread = useCallback(async (): Promise<string | null> => {
    return goToAdjacentThread("previous")
  }, [goToAdjacentThread])
  const goToNextThread = useCallback(async (): Promise<string | null> => {
    return goToAdjacentThread("next")
  }, [goToAdjacentThread])

  useEffect(() => {
    let cancelled = false

    async function hydrateInitialThread(): Promise<void> {
      const threads = await listAiThreads()

      if (cancelled || shouldStartFreshThread || threadId) {
        return
      }

      const activeThreadId = resolveActiveThreadId()
      const restoredThreadId =
        activeThreadId && threads.some((thread) => thread.thread_id === activeThreadId)
          ? activeThreadId
          : (threads[0]?.thread_id ?? null)

      if (!restoredThreadId) {
        await refreshAdjacentThreadIds(null)
        return
      }

      await activateThread(restoredThreadId)
    }

    void hydrateInitialThread()

    return () => {
      cancelled = true
    }
  }, [
    activateThread,
    listAiThreads,
    refreshAdjacentThreadIds,
    resolveActiveThreadId,
    shouldStartFreshThread,
    threadId
  ])

  useEffect(() => {
    const handleWindowFocus = (): void => {
      void (async () => {
        const activeThreadId = resolveActiveThreadId()
        if (activeThreadId !== threadId) {
          setThreadId(activeThreadId)
        }

        await refreshAdjacentThreadIds(activeThreadId)
        if (!activeThreadId) {
          return
        }

        const isStreaming = threadContext.getStreamData(activeThreadId).isLoading
        if (!shouldReloadLauncherAiThreadOnFocus({ activeThreadId, isStreaming })) {
          return
        }

        await threadHost.reload(activeThreadId)
      })()
    }

    window.addEventListener("focus", handleWindowFocus)
    return () => {
      window.removeEventListener("focus", handleWindowFocus)
    }
  }, [refreshAdjacentThreadIds, resolveActiveThreadId, threadContext, threadHost, threadId])

  return {
    branchThread,
    canGoToNextThread: Boolean(adjacentThreadIds.next),
    canGoToPreviousThread: Boolean(adjacentThreadIds.previous),
    createThread,
    goToNextThread,
    goToPreviousThread,
    threadId
  }
}
