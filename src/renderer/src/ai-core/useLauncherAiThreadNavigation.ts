import { useCallback, useEffect, useRef, useState } from "react"
import { AI_THREAD_SOURCE } from "@shared/launcher-ai"
import { DEFAULT_PERMISSION_MODE, type PermissionModeName } from "@shared/permission-mode"
import type { ThreadWorkspaceKind } from "@shared/thread-workspace"
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
      workspaceKind: ThreadWorkspaceKind
      workspacePath: string | null
    }
  | {
      kind: "thread"
      threadId: string
    }

export type LauncherAiThreadLoadingReason = "opening" | "restoring"

interface LauncherAiThreadHydration {
  count: number
  reason: LauncherAiThreadLoadingReason | null
}

export interface LauncherAiThreadNavigation {
  branchThread: (threadId: string) => Promise<AiCoreThreadHandle>
  branchThreadUntilMessage: (threadId: string, messageId: string) => Promise<AiCoreThreadHandle>
  canGoToNextThread: boolean
  canGoToPreviousThread: boolean
  createThread: (input: AiCoreThreadCreateInput) => Promise<AiCoreThreadHandle>
  defaultDraftPermissionMode: PermissionModeName
  openThread: (threadId: string) => Promise<void>
  isHydratingThread: boolean
  threadLoadingReason: LauncherAiThreadLoadingReason | null
  startFreshDraft: (input: {
    modelId: string | null
    permissionMode: PermissionModeName
    workspaceKind?: ThreadWorkspaceKind
    workspacePath?: string | null
  }) => Promise<void>
  target: LauncherAiActiveTarget | null
  updateFreshDraft: (
    input: Partial<{
      modelId: string | null
      permissionMode: PermissionModeName
      workspaceKind: ThreadWorkspaceKind
      workspacePath: string | null
    }>
  ) => void
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

async function canActivateThread(input: {
  nextThreadId: string
  onBeforeActivate?: (threadId: string) => Promise<boolean>
}): Promise<boolean> {
  const { nextThreadId, onBeforeActivate } = input
  if (onBeforeActivate) {
    return onBeforeActivate(nextThreadId)
  }

  return true
}

export function useLauncherAiThreadNavigation(
  options: UseLauncherAiThreadNavigationOptions
): LauncherAiThreadNavigation {
  const { seedQuery } = options
  const threadHost = useAiCoreThreads()
  const {
    activate,
    clone,
    cloneUntilMessage,
    create,
    getActiveThreadId,
    list,
    mode,
    onBeforeActivate
  } = threadHost
  const initialThreadId = mode === "main" ? getActiveThreadId() : null
  const shouldStartFreshThread =
    mode === "launcher" && shouldStartFreshLauncherAiThread({ seedQuery })
  const [target, setTarget] = useState<LauncherAiActiveTarget | null>(
    initialThreadId
      ? {
          kind: "thread",
          threadId: initialThreadId
        }
      : shouldStartFreshThread
        ? {
            kind: "draft",
            modelId: null,
            permissionMode: DEFAULT_PERMISSION_MODE,
            workspaceKind: "projectless",
            workspacePath: null
          }
        : null
  )
  const [adjacentThreadIds, setAdjacentThreadIds] = useState<AdjacentThreadIds>({
    next: null,
    previous: null
  })
  const [threadHydration, setThreadHydration] = useState<LauncherAiThreadHydration>(() => ({
    count: shouldStartFreshThread ? 0 : 1,
    reason: shouldStartFreshThread ? null : "restoring"
  }))
  const isMountedRef = useRef(true)
  const initialHydrationPendingRef = useRef(!shouldStartFreshThread)
  const navigationVersionRef = useRef(0)
  const threadId = target?.kind === "thread" ? target.threadId : null
  const isFreshDraftActive = target?.kind === "draft"
  const isHydratingThread = threadHydration.count > 0

  useEffect(() => {
    const isMounted = isMountedRef
    isMounted.current = true

    return () => {
      isMounted.current = false
    }
  }, [])

  const beginThreadHydration = useCallback(
    (reason: LauncherAiThreadLoadingReason): (() => void) => {
      let finished = false
      setThreadHydration((current) => ({
        count: current.count + 1,
        reason
      }))

      return () => {
        if (finished || !isMountedRef.current) {
          return
        }

        finished = true
        setThreadHydration((current) => {
          const nextCount = Math.max(0, current.count - 1)
          return {
            count: nextCount,
            reason: nextCount > 0 ? current.reason : null
          }
        })
      }
    },
    []
  )
  const finishInitialThreadHydration = useCallback((): void => {
    if (!isMountedRef.current) {
      return
    }

    setThreadHydration((current) => {
      const nextCount = Math.max(0, current.count - 1)
      return {
        count: nextCount,
        reason: nextCount > 0 ? current.reason : null
      }
    })
  }, [])

  const listAiThreads = useCallback(async (): Promise<Thread[]> => {
    return listLauncherAiThreadsByRecency(await list())
  }, [list])
  const resolveActiveThreadId = useCallback((): string | null => {
    if (isFreshDraftActive || (shouldStartFreshThread && !threadId)) {
      return null
    }

    return getActiveThreadId() ?? threadId
  }, [getActiveThreadId, isFreshDraftActive, shouldStartFreshThread, threadId])
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
    async (
      nextThreadId: string,
      reason: LauncherAiThreadLoadingReason = "opening",
      expectedNavigationVersion?: number
    ): Promise<void> => {
      const canActivate = await canActivateThread({
        nextThreadId,
        onBeforeActivate
      })
      if (canActivate === false) {
        return
      }
      if (
        expectedNavigationVersion !== undefined &&
        expectedNavigationVersion !== navigationVersionRef.current
      ) {
        return
      }

      const navigationVersion = navigationVersionRef.current + 1
      navigationVersionRef.current = navigationVersion
      const finishHydration = beginThreadHydration(reason)
      try {
        setTarget((currentTarget) =>
          currentTarget?.kind === "thread" && currentTarget.threadId === nextThreadId
            ? currentTarget
            : {
                kind: "thread",
                threadId: nextThreadId
              }
        )
        await activate(nextThreadId)
        if (navigationVersion !== navigationVersionRef.current) {
          return
        }
        await refreshAdjacentThreadIds(nextThreadId, { freshDraftActive: false })
      } finally {
        finishHydration()
      }
    },
    [activate, beginThreadHydration, onBeforeActivate, refreshAdjacentThreadIds]
  )
  const createThread = useCallback(
    async (input: AiCoreThreadCreateInput): Promise<AiCoreThreadHandle> => {
      const expectedNavigationVersion = navigationVersionRef.current
      const createdThread = await create(input)
      await activateThread(createdThread.threadId, "opening", expectedNavigationVersion)
      return createdThread
    },
    [activateThread, create]
  )
  const branchThread = useCallback(
    async (sourceThreadId: string): Promise<AiCoreThreadHandle> => {
      const branchedThread = await clone(sourceThreadId)
      await activateThread(branchedThread.threadId)
      return branchedThread
    },
    [activateThread, clone]
  )
  const branchThreadUntilMessage = useCallback(
    async (sourceThreadId: string, messageId: string): Promise<AiCoreThreadHandle> => {
      const branchedThread = await cloneUntilMessage(sourceThreadId, messageId)
      await activateThread(branchedThread.threadId)
      return branchedThread
    },
    [activateThread, cloneUntilMessage]
  )
  const startFreshDraft = useCallback(
    async (input: {
      modelId: string | null
      permissionMode: PermissionModeName
      workspaceKind?: ThreadWorkspaceKind
      workspacePath?: string | null
    }): Promise<void> => {
      const activeThreadId = resolveActiveThreadId()
      const navigationVersion = navigationVersionRef.current + 1
      navigationVersionRef.current = navigationVersion
      initialHydrationPendingRef.current = false
      setThreadHydration({
        count: 0,
        reason: null
      })
      setTarget({
        kind: "draft",
        modelId: input.modelId,
        permissionMode: input.permissionMode,
        workspaceKind: input.workspaceKind ?? "projectless",
        workspacePath: input.workspacePath ?? null
      })
      setAdjacentThreadIds({
        next: null,
        previous: activeThreadId
      })
      void listAiThreads()
        .then((threads) => {
          if (!isMountedRef.current || navigationVersion !== navigationVersionRef.current) {
            return
          }

          setAdjacentThreadIds(getAdjacentThreadIds(threads, null, true))
        })
        .catch((error: unknown) => {
          console.warn("[LauncherAi] Failed to refresh adjacent threads for fresh draft:", error)
        })
    },
    [listAiThreads, resolveActiveThreadId]
  )
  const updateFreshDraft = useCallback(
    (
      input: Partial<{
        modelId: string | null
        permissionMode: PermissionModeName
        workspaceKind: ThreadWorkspaceKind
        workspacePath: string | null
      }>
    ): void => {
      setTarget((currentTarget) => {
        if (!currentTarget) {
          return {
            kind: "draft",
            modelId: input.modelId !== undefined ? input.modelId : null,
            permissionMode: input.permissionMode ?? DEFAULT_PERMISSION_MODE,
            workspaceKind: input.workspaceKind ?? "projectless",
            workspacePath: input.workspacePath ?? null
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
      const adjacentThreadId = getAdjacentThreadIds(threads, activeThreadId, isFreshDraftActive)[
        direction
      ]
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
    if (initialThreadId) {
      if (initialHydrationPendingRef.current) {
        initialHydrationPendingRef.current = false
        void activateThread(initialThreadId, "restoring").finally(finishInitialThreadHydration)
      }
      return
    }

    if (target?.kind === "thread") {
      return
    }

    async function hydrateInitialThread(): Promise<void> {
      const hydrationVersion = navigationVersionRef.current
      try {
        const threads = await listAiThreads()

        if (!isMountedRef.current || hydrationVersion !== navigationVersionRef.current) {
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
          setTarget({
            kind: "draft",
            modelId: null,
            permissionMode: DEFAULT_PERMISSION_MODE,
            workspaceKind: "projectless",
            workspacePath: null
          })
          setAdjacentThreadIds({
            next: null,
            previous: null
          })
          return
        }

        if (hydrationVersion === navigationVersionRef.current) {
          await activateThread(restoredThreadId, "restoring")
        }
      } finally {
        finishInitialThreadHydration()
      }
    }

    if (initialHydrationPendingRef.current) {
      initialHydrationPendingRef.current = false
      void hydrateInitialThread()
    }
  }, [
    activateThread,
    finishInitialThreadHydration,
    listAiThreads,
    initialThreadId,
    refreshAdjacentThreadIds,
    resolveActiveThreadId,
    target,
    shouldStartFreshThread
  ])

  return {
    branchThread,
    branchThreadUntilMessage,
    canGoToNextThread: Boolean(adjacentThreadIds.next),
    canGoToPreviousThread: Boolean(adjacentThreadIds.previous),
    createThread,
    defaultDraftPermissionMode: DEFAULT_PERMISSION_MODE,
    openThread: activateThread,
    isHydratingThread,
    threadLoadingReason: threadHydration.reason,
    startFreshDraft,
    target,
    updateFreshDraft,
    goToNextThread,
    goToPreviousThread,
    threadId
  }
}
