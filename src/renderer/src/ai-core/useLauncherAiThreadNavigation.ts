import { useCallback, useEffect, useState } from "react"
import { AI_THREAD_SOURCE } from "@shared/launcher-ai"
import { DEFAULT_PERMISSION_MODE, type PermissionModeName } from "@shared/permission-mode"
import type { Thread } from "@/types"
import type { AiCoreThreadCreateInput, AiCoreThreadHandle } from "./AiCoreHost"
import { useAiCoreThreads } from "./AiCoreHost"
import {
  resolveLauncherAiAdjacentThreadIds,
  shouldStartFreshLauncherAiThread
} from "./launcher-ai-thread-navigation-core"

interface UseLauncherAiThreadNavigationOptions {
  initialAction: "focus" | "submit"
  seedQuery: string
}

export type LauncherAiActiveTarget =
  | {
      kind: "draft"
      modelId: string | null
      permissionMode: PermissionModeName
    }
  | {
      kind: "thread"
      threadId: string
    }

export interface LauncherAiThreadNavigation {
  branchThread: (threadId: string) => Promise<AiCoreThreadHandle>
  branchThreadUntilMessage: (threadId: string, messageId: string) => Promise<AiCoreThreadHandle>
  canGoToNextThread: boolean
  canGoToPreviousThread: boolean
  createThread: (input: AiCoreThreadCreateInput) => Promise<AiCoreThreadHandle>
  defaultDraftPermissionMode: PermissionModeName
  startFreshDraft: (input: {
    modelId: string | null
    permissionMode: PermissionModeName
  }) => Promise<void>
  target: LauncherAiActiveTarget | null
  updateFreshDraft: (input: Partial<{
    modelId: string | null
    permissionMode: PermissionModeName
  }>) => void
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
    .sort(
      (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
    )
}

function getAdjacentThreadIds(
  threads: readonly Thread[],
  activeThreadId: string | null,
  isFreshDraftActive: boolean
): AdjacentThreadIds {
  return resolveLauncherAiAdjacentThreadIds({
    activeThreadId,
    isFreshDraftActive,
    threadIdsByRecency: threads.map((thread) => thread.thread_id)
  })
}

export function useLauncherAiThreadNavigation(
  options: UseLauncherAiThreadNavigationOptions
): LauncherAiThreadNavigation {
  const { seedQuery } = options
  const threadHost = useAiCoreThreads()
  const shouldStartFreshThread = shouldStartFreshLauncherAiThread({ seedQuery })
  const [target, setTarget] = useState<LauncherAiActiveTarget | null>(
    shouldStartFreshThread
      ? {
          kind: "draft",
          modelId: null,
          permissionMode: DEFAULT_PERMISSION_MODE
        }
      : null
  )
  const [adjacentThreadIds, setAdjacentThreadIds] = useState<AdjacentThreadIds>({
    next: null,
    previous: null
  })
  const threadId = target?.kind === "thread" ? target.threadId : null
  const isFreshDraftActive = target?.kind === "draft"

  const listAiThreads = useCallback(async (): Promise<Thread[]> => {
    return listLauncherAiThreadsByRecency(await threadHost.list())
  }, [threadHost])
  const resolveActiveThreadId = useCallback((): string | null => {
    if (isFreshDraftActive || (shouldStartFreshThread && !threadId)) {
      return null
    }

    return threadHost.getActiveThreadId() ?? threadId
  }, [isFreshDraftActive, shouldStartFreshThread, threadHost, threadId])
  const refreshAdjacentThreadIds = useCallback(
    async (
      activeThreadId: string | null,
      options?: { freshDraftActive?: boolean }
    ): Promise<void> => {
      const threads = await listAiThreads()
      setAdjacentThreadIds(
        getAdjacentThreadIds(
          threads,
          activeThreadId,
          options?.freshDraftActive ?? isFreshDraftActive
        )
      )
    },
    [isFreshDraftActive, listAiThreads]
  )
  const activateThread = useCallback(
    async (nextThreadId: string): Promise<void> => {
      setTarget({
        kind: "thread",
        threadId: nextThreadId
      })
      await threadHost.activate(nextThreadId)
      await refreshAdjacentThreadIds(nextThreadId, { freshDraftActive: false })
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
  const branchThreadUntilMessage = useCallback(
    async (sourceThreadId: string, messageId: string): Promise<AiCoreThreadHandle> => {
      const branchedThread = await threadHost.cloneUntilMessage(sourceThreadId, messageId)
      await activateThread(branchedThread.threadId)
      return branchedThread
    },
    [activateThread, threadHost]
  )
  const startFreshDraft = useCallback(async (input: {
    modelId: string | null
    permissionMode: PermissionModeName
  }): Promise<void> => {
    const threads = await listAiThreads()
    setTarget({
      kind: "draft",
      modelId: input.modelId,
      permissionMode: input.permissionMode
    })
    setAdjacentThreadIds(getAdjacentThreadIds(threads, null, true))
  }, [listAiThreads])
  const updateFreshDraft = useCallback(
    (input: Partial<{ modelId: string | null; permissionMode: PermissionModeName }>): void => {
      setTarget((currentTarget) => {
        if (!currentTarget) {
          return {
            kind: "draft",
            modelId:
              input.modelId !== undefined
                ? input.modelId
                : null,
            permissionMode: input.permissionMode ?? DEFAULT_PERMISSION_MODE
          }
        }

        if (currentTarget?.kind !== "draft") {
          return currentTarget
        }

        return {
          ...currentTarget,
          ...input
        }
      })
    },
    []
  )
  const goToAdjacentThread = useCallback(
    async (direction: keyof AdjacentThreadIds): Promise<string | null> => {
      const threads = await listAiThreads()
      const activeThreadId = resolveActiveThreadId()
      const adjacentThreadId = getAdjacentThreadIds(
        threads,
        activeThreadId,
        isFreshDraftActive
      )[direction]
      if (!adjacentThreadId) {
        setAdjacentThreadIds(getAdjacentThreadIds(threads, activeThreadId, isFreshDraftActive))
        return null
      }

      await activateThread(adjacentThreadId)
      return adjacentThreadId
    },
    [activateThread, isFreshDraftActive, listAiThreads, resolveActiveThreadId]
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

      if (cancelled || target?.kind === "thread") {
        return
      }

      if (shouldStartFreshThread || target?.kind === "draft") {
        await refreshAdjacentThreadIds(null, { freshDraftActive: true })
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
    target,
    shouldStartFreshThread,
  ])

  return {
    branchThread,
    branchThreadUntilMessage,
    canGoToNextThread: Boolean(adjacentThreadIds.next),
    canGoToPreviousThread: Boolean(adjacentThreadIds.previous),
    createThread,
    defaultDraftPermissionMode: DEFAULT_PERMISSION_MODE,
    startFreshDraft,
    target,
    updateFreshDraft,
    goToNextThread,
    goToPreviousThread,
    threadId
  }
}
