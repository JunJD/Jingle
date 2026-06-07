import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react"

/* eslint-disable react-refresh/only-export-components */
import { THREAD_PERMISSION_MODE_METADATA_KEY } from "@shared/permission-mode"
import { createAgentRuntimeManager } from "./agent-runtime-manager"
import { historyShellStore } from "./history-shell-store"
import { createThreadStore, type ThreadActions, type ThreadState } from "./thread-store-core"

export type { OpenArtifactTab, OpenFile } from "@shared/thread-tabs"
export type {
  AgentToolExecutionView,
  AgentToolExecutionsView,
  ThreadActions,
  ThreadState,
  TokenUsage
} from "./thread-store-core"
export { getArtifactTabId } from "@shared/thread-tabs"

export interface ThreadContextValue {
  getThreadState: (threadId: string) => ThreadState | null
  getThreadActions: (threadId: string) => ThreadActions
  ensureThreadRuntime: (threadId: string) => void
  awaitThreadRuntime: (threadId: string) => Promise<void>
  loadThreadData: (threadId: string) => Promise<void>
  cleanupThread: (threadId: string) => void
  subscribeThread: (threadId: string, callback: () => void) => () => void
  getAllThreadStates: () => Record<string, ThreadState>
  subscribeAllThreadStates: (callback: () => void) => () => void
}

const ThreadContext = createContext<ThreadContextValue | null>(null)

export function ThreadProvider({ children }: { children: ReactNode }) {
  const [threadStore] = useState(() =>
    createThreadStore({
      persistCurrentModel: async (threadId: string, modelId: string) => {
        const thread = await window.api.threads.get(threadId)
        if (!thread) {
          return
        }

        const metadata = thread.metadata || {}
        await window.api.threads.update(threadId, {
          metadata: { ...metadata, model: modelId }
        })
      },
      persistPermissionMode: async (threadId, permissionMode) => {
        const thread = await window.api.threads.get(threadId)
        if (!thread) {
          return
        }

        const metadata = thread.metadata || {}
        await window.api.threads.update(threadId, {
          metadata: { ...metadata, [THREAD_PERMISSION_MODE_METADATA_KEY]: permissionMode }
        })
      }
    })
  )
  const [runtimeManager] = useState(() =>
    createAgentRuntimeManager({
      refreshThread: (threadId) => historyShellStore.getState().refreshThread(threadId),
      threadStore
    })
  )

  const getThreadState = useCallback(
    (threadId: string): ThreadState | null => threadStore.getThreadState(threadId),
    [threadStore]
  )
  const getThreadActions = useCallback(
    (threadId: string): ThreadActions => threadStore.getThreadActions(threadId),
    [threadStore]
  )
  const subscribeThread = useCallback(
    (threadId: string, callback: () => void): (() => void) =>
      threadStore.subscribeThread(threadId, callback),
    [threadStore]
  )
  const getAllThreadStates = useCallback((): Record<string, ThreadState> => {
    return threadStore.getAllThreadStates()
  }, [threadStore])
  const subscribeAllThreadStates = useCallback(
    (callback: () => void): (() => void) => threadStore.subscribeAllThreadStates(callback),
    [threadStore]
  )
  const ensureThreadRuntime = useCallback(
    (threadId: string): void => runtimeManager.ensureThreadRuntime(threadId),
    [runtimeManager]
  )

  const awaitThreadRuntime = useCallback(
    (threadId: string): Promise<void> => runtimeManager.awaitThreadRuntime(threadId),
    [runtimeManager]
  )

  const cleanupThread = useCallback(
    (threadId: string): void => {
      runtimeManager.cleanupThreadRuntime(threadId)
      threadStore.deleteThreadState(threadId)
    },
    [runtimeManager, threadStore]
  )

  const loadThreadData = useCallback(
    (threadId: string): Promise<void> => runtimeManager.loadThreadData(threadId),
    [runtimeManager]
  )

  useEffect(() => {
    return window.api.artifacts.onChanged(({ artifacts, threadId }) => {
      threadStore.applyArtifactsChanged(threadId, artifacts)
    })
  }, [threadStore])

  const contextValue = useMemo<ThreadContextValue>(
    () => ({
      getThreadState,
      getThreadActions,
      ensureThreadRuntime,
      awaitThreadRuntime,
      loadThreadData,
      cleanupThread,
      subscribeThread,
      getAllThreadStates,
      subscribeAllThreadStates
    }),
    [
      cleanupThread,
      awaitThreadRuntime,
      ensureThreadRuntime,
      getAllThreadStates,
      getThreadActions,
      getThreadState,
      loadThreadData,
      subscribeAllThreadStates,
      subscribeThread
    ]
  )

  return <ThreadContext.Provider value={contextValue}>{children}</ThreadContext.Provider>
}

export function useThreadContext(): ThreadContextValue {
  const context = useContext(ThreadContext)
  if (!context) {
    throw new Error("useThreadContext must be used within a ThreadProvider")
  }
  return context
}

export function useThreadActions(threadId: string | null): ThreadActions | null {
  const context = useThreadContext()

  if (!threadId) {
    return null
  }

  return context.getThreadActions(threadId)
}

export function useThreadSelector<T>(
  threadId: string | null,
  selector: (state: ThreadState | null) => T
): T {
  const context = useThreadContext()

  const subscribe = useCallback(
    (callback: () => void) => {
      if (!threadId) {
        return () => {}
      }

      return context.subscribeThread(threadId, callback)
    },
    [context, threadId]
  )
  const getSnapshot = useCallback(() => {
    return selector(threadId ? context.getThreadState(threadId) : null)
  }, [context, selector, threadId])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useAllThreadStates(): Record<string, ThreadState> {
  const context = useThreadContext()
  return useSyncExternalStore(
    context.subscribeAllThreadStates,
    context.getAllThreadStates,
    context.getAllThreadStates
  )
}
