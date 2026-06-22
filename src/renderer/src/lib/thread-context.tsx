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
import { createAgentRuntimeManager } from "./agent-runtime-manager"
import { historyShellStore } from "./history-shell-store"
import { createThreadStore, type ThreadControl, type ThreadState } from "./thread-store-core"

export type { OpenArtifactTab, OpenFile } from "@shared/thread-tabs"
export type {
  ThreadControl,
  TokenUsage
} from "./thread-store-core"
export { getArtifactTabId, getFileTabId } from "@shared/thread-tabs"

export type AgentCommandState = Pick<
  ThreadState["agent"],
  "activeRun" | "currentModel" | "pendingApproval" | "permissionMode" | "workspacePath"
>

export interface ThreadContextValue {
  getAgentCommandState: (threadId: string) => AgentCommandState | null
  getThreadControl: (threadId: string) => ThreadControl
  ensureThreadRuntime: (threadId: string) => void
  awaitThreadRuntime: (threadId: string) => Promise<void>
  loadThreadData: (threadId: string) => Promise<void>
  cleanupThread: (threadId: string) => void
}

interface ThreadContextInternalValue extends ThreadContextValue {
  getThreadState: (threadId: string) => ThreadState | null
  subscribeThread: (threadId: string, callback: () => void) => () => void
}

const ThreadContext = createContext<ThreadContextInternalValue | null>(null)

export function ThreadProvider({ children }: { children: ReactNode }) {
  const [threadStore] = useState(() => createThreadStore())
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
  const getAgentCommandState = useCallback(
    (threadId: string): AgentCommandState | null => {
      const state = threadStore.getThreadState(threadId)
      if (!state) {
        return null
      }

      return {
        activeRun: state.agent.activeRun,
        currentModel: state.agent.currentModel,
        pendingApproval: state.agent.pendingApproval,
        permissionMode: state.agent.permissionMode,
        workspacePath: state.agent.workspacePath
      }
    },
    [threadStore]
  )
  const getThreadControl = useCallback(
    (threadId: string): ThreadControl => threadStore.getThreadControl(threadId),
    [threadStore]
  )
  const subscribeThread = useCallback(
    (threadId: string, callback: () => void): (() => void) =>
      threadStore.subscribeThread(threadId, callback),
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

  const contextValue = useMemo<ThreadContextInternalValue>(
    () => ({
      getAgentCommandState,
      getThreadState,
      getThreadControl,
      ensureThreadRuntime,
      awaitThreadRuntime,
      loadThreadData,
      cleanupThread,
      subscribeThread
    }),
    [
      cleanupThread,
      awaitThreadRuntime,
      ensureThreadRuntime,
      getAgentCommandState,
      getThreadControl,
      getThreadState,
      loadThreadData,
      subscribeThread
    ]
  )

  return <ThreadContext.Provider value={contextValue}>{children}</ThreadContext.Provider>
}

export function useThreadContext(): ThreadContextValue {
  return useThreadContextInternal()
}

function useThreadContextInternal(): ThreadContextInternalValue {
  const context = useContext(ThreadContext)
  if (!context) {
    throw new Error("useThreadContext must be used within a ThreadProvider")
  }
  return context
}

export function useThreadControl(threadId: string): ThreadControl
export function useThreadControl(threadId: null): null
export function useThreadControl(threadId: string | null): ThreadControl | null
export function useThreadControl(threadId: string | null): ThreadControl | null {
  const context = useThreadContextInternal()

  if (!threadId) {
    return null
  }

  return context.getThreadControl(threadId)
}

export function useThreadSelector<T>(
  threadId: string | null,
  selector: (state: ThreadState | null) => T
): T {
  const context = useThreadContextInternal()

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
