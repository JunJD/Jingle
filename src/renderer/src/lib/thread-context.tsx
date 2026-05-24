import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode
} from "react"

/* eslint-disable react-refresh/only-export-components */
import type { AgentThreadProjection } from "@shared/agent-projection"
import type { ArtifactRecord } from "@shared/artifacts"
import { isPermissionModeName, THREAD_PERMISSION_MODE_METADATA_KEY } from "@shared/permission-mode"
import { getIpcErrorDisplayMessage, getIpcErrorPayload } from "./ipc-errors"
import { historyShellStore } from "./history-shell-store"
import {
  createThreadStore,
  type ThreadActions,
  type ThreadRecord,
  type ThreadState
} from "./thread-store-core"

export type { OpenArtifactTab, OpenFile } from "@shared/thread-tabs"
export type { ThreadActions, ThreadRecord, ThreadState, TokenUsage } from "./thread-store-core"
export { getArtifactTabId } from "@shared/thread-tabs"

interface StreamData {
  isLoading: boolean
  messages: ThreadState["messages"]
  stream: null
}

export interface ThreadContextValue {
  getThreadRecord: (threadId: string) => ThreadRecord
  getThreadState: (threadId: string) => ThreadState
  getThreadActions: (threadId: string) => ThreadActions
  ensureThreadRuntime: (threadId: string) => void
  cleanupThread: (threadId: string) => void
  reloadThread: (threadId: string) => Promise<void>
  subscribeThread: (threadId: string, callback: () => void) => () => void
  subscribeToStream: (threadId: string, callback: () => void) => () => void
  getStreamData: (threadId: string) => StreamData
  getAllThreadStates: () => Record<string, ThreadState>
  subscribeAllThreadStates: (callback: () => void) => () => void
  getAllStreamLoadingStates: () => Record<string, boolean>
  subscribeAllStreamLoadingStates: (callback: () => void) => () => void
  subscribeToAllStreams: (callback: () => void) => () => void
}

const defaultStreamData: StreamData = {
  isLoading: false,
  messages: [],
  stream: null
}

const ThreadContext = createContext<ThreadContextValue | null>(null)

function parseErrorMessage(error: Error | string | AgentThreadProjection["error"]): string {
  const ipcError = getIpcErrorPayload(error)
  const errorMessage = ipcError?.message ?? getIpcErrorDisplayMessage(error, "Unknown error")

  const contextWindowMatch = errorMessage.match(/prompt is too long: (\d+) tokens > (\d+) maximum/i)
  if (contextWindowMatch) {
    const [, usedTokens, maxTokens] = contextWindowMatch
    const usedK = Math.round(parseInt(usedTokens, 10) / 1000)
    const maxK = Math.round(parseInt(maxTokens, 10) / 1000)
    return `Context window exceeded (${usedK}K / ${maxK}K tokens). The conversation history is too long. Please start a new thread to continue.`
  }

  if (errorMessage.includes("rate_limit") || errorMessage.includes("429")) {
    return "Rate limit exceeded. Please wait a moment before sending another message."
  }

  if (
    errorMessage.includes("401") ||
    errorMessage.includes("invalid_api_key") ||
    errorMessage.includes("authentication")
  ) {
    return "Authentication failed. Please check your API key in settings."
  }

  return errorMessage
}

export function ThreadProvider({ children }: { children: ReactNode }) {
  const initializedThreadsRef = useRef<Set<string>>(new Set())
  const projectionCleanupRef = useRef<Record<string, () => void>>({})
  const threadStoreRef = useRef(
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
  const threadStore = threadStoreRef.current
  const streamDataRef = useRef<Record<string, StreamData>>({})
  const streamSubscribersRef = useRef<Record<string, Set<() => void>>>({})

  const notifyStreamSubscribers = useCallback((threadId: string): void => {
    streamSubscribersRef.current[threadId]?.forEach((callback) => callback())
  }, [])

  const refreshThreadForkState = useCallback(
    async (threadId: string): Promise<void> => {
      try {
        const runtimeState = await window.api.threads.getRuntimeState(threadId)
        threadStore.getThreadActions(threadId).setForkState(runtimeState.forkState)
      } catch (error) {
        console.error("[ThreadContext] Failed to refresh thread fork state:", error)
      }
    },
    [threadStore]
  )

  const applyProjectionUpdate = useCallback(
    (threadId: string, projection: AgentThreadProjection): void => {
      const previousState = threadStore.getThreadState(threadId)
      const wasLoading = streamDataRef.current[threadId]?.isLoading ?? false
      const shouldRefreshForkState =
        wasLoading !== projection.isLoading ||
        previousState.pendingApproval?.id !== projection.pendingApproval?.id

      threadStore.updateThreadState(threadId, () => ({
        error: projection.error ? parseErrorMessage(projection.error) : null,
        messages: projection.messages,
        pendingApproval: projection.pendingApproval,
        runId: projection.runId,
        subagents: projection.subagents,
        todos: projection.todos,
        tokenUsage: projection.tokenUsage
      }))

      streamDataRef.current[threadId] = {
        isLoading: projection.isLoading,
        messages: projection.messages,
        stream: null
      }
      threadStore.setStreamLoadingState(threadId, projection.isLoading)
      notifyStreamSubscribers(threadId)

      if (wasLoading && !projection.isLoading) {
        void historyShellStore.getState().loadThreads()
      }

      if (shouldRefreshForkState) {
        void refreshThreadForkState(threadId)
      }
    },
    [notifyStreamSubscribers, refreshThreadForkState, threadStore]
  )

  const getThreadRecord = useCallback(
    (threadId: string): ThreadRecord => threadStore.getThreadRecord(threadId),
    [threadStore]
  )
  const getThreadState = useCallback(
    (threadId: string): ThreadState => threadStore.getThreadState(threadId),
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
  const getAllStreamLoadingStates = useCallback((): Record<string, boolean> => {
    return threadStore.getAllStreamLoadingStates()
  }, [threadStore])
  const subscribeAllStreamLoadingStates = useCallback(
    (callback: () => void): (() => void) => threadStore.subscribeAllStreamLoadingStates(callback),
    [threadStore]
  )

  const subscribeToStream = useCallback((threadId: string, callback: () => void) => {
    if (!streamSubscribersRef.current[threadId]) {
      streamSubscribersRef.current[threadId] = new Set()
    }
    streamSubscribersRef.current[threadId].add(callback)

    return () => {
      streamSubscribersRef.current[threadId]?.delete(callback)
    }
  }, [])

  const getStreamData = useCallback((threadId: string): StreamData => {
    return streamDataRef.current[threadId] || defaultStreamData
  }, [])

  const subscribeToAllStreams = useCallback((_callback: () => void) => {
    return () => {}
  }, [])

  const ensureThreadRuntime = useCallback(
    (threadId: string): void => {
      if (initializedThreadsRef.current.has(threadId)) {
        return
      }

      initializedThreadsRef.current.add(threadId)
      threadStore.ensureThreadState(threadId)
      projectionCleanupRef.current[threadId] = window.api.agent.subscribeProjection(
        threadId,
        (envelope) => {
          applyProjectionUpdate(threadId, envelope.projection)
        }
      )
    },
    [applyProjectionUpdate, threadStore]
  )

  const cleanupThread = useCallback(
    (threadId: string): void => {
      initializedThreadsRef.current.delete(threadId)
      projectionCleanupRef.current[threadId]?.()
      delete projectionCleanupRef.current[threadId]
      delete streamDataRef.current[threadId]
      delete streamSubscribersRef.current[threadId]
      threadStore.deleteThreadState(threadId)
    },
    [threadStore]
  )

  const loadThreadHistory = useCallback(
    async (threadId: string): Promise<void> => {
      const actions = getThreadActions(threadId)

      try {
        const thread = await window.api.threads.get(threadId)
        if (thread) {
          const metadata = thread.metadata || {}
          if (metadata.workspacePath) {
            actions.setWorkspacePath(metadata.workspacePath as string)
          }
          if (metadata.model) {
            threadStore.updateThreadState(threadId, () => ({
              currentModel: metadata.model as string
            }))
          }
          const permissionMode = metadata[THREAD_PERMISSION_MODE_METADATA_KEY]
          if (isPermissionModeName(permissionMode)) {
            threadStore.updateThreadState(threadId, () => ({
              permissionMode
            }))
          }
        }
      } catch (error) {
        console.error("[ThreadContext] Failed to load thread details:", error)
      }

      try {
        const history = await window.api.threads.getHistory(threadId)
        actions.setArtifacts(history.artifacts)
        actions.setForkState(history.forkState)
      } catch (error) {
        console.error("[ThreadContext] Failed to load thread artifacts:", error)
      }

      try {
        const envelope = await window.api.agent.getProjection(threadId)
        applyProjectionUpdate(threadId, envelope.projection)
        const runtimeState = await window.api.threads.getRuntimeState(threadId)
        actions.setForkState(runtimeState.forkState)
      } catch (error) {
        console.error("[ThreadContext] Failed to load thread projection:", error)
      }
    },
    [applyProjectionUpdate, getThreadActions, threadStore]
  )

  const reloadThread = useCallback(
    async (threadId: string): Promise<void> => {
      ensureThreadRuntime(threadId)
      await loadThreadHistory(threadId)
    },
    [ensureThreadRuntime, loadThreadHistory]
  )

  useEffect(() => {
    return window.api.artifacts.onChanged(({ artifacts, threadId }) => {
      threadStore.getThreadActions(threadId).setArtifacts(artifacts as ArtifactRecord[])
    })
  }, [threadStore])

  const contextValue = useMemo<ThreadContextValue>(
    () => ({
      getThreadRecord,
      getThreadState,
      getThreadActions,
      ensureThreadRuntime,
      cleanupThread,
      reloadThread,
      subscribeThread,
      subscribeToStream,
      getStreamData,
      getAllThreadStates,
      subscribeAllThreadStates,
      getAllStreamLoadingStates,
      subscribeAllStreamLoadingStates,
      subscribeToAllStreams
    }),
    [
      cleanupThread,
      ensureThreadRuntime,
      getAllStreamLoadingStates,
      getAllThreadStates,
      getStreamData,
      getThreadActions,
      getThreadRecord,
      getThreadState,
      reloadThread,
      subscribeAllStreamLoadingStates,
      subscribeAllThreadStates,
      subscribeThread,
      subscribeToAllStreams,
      subscribeToStream
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

function useThreadRecordSnapshot(threadId: string | null): ThreadRecord | null {
  const context = useThreadContext()

  useEffect(() => {
    if (threadId) {
      context.ensureThreadRuntime(threadId)
    }
  }, [context, threadId])

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
    if (!threadId) {
      return null
    }

    return context.getThreadRecord(threadId)
  }, [context, threadId])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useThreadStream(threadId: string | null): StreamData {
  const context = useThreadContext()

  const subscribe = useCallback(
    (callback: () => void) => {
      if (!threadId) {
        return () => {}
      }

      return context.subscribeToStream(threadId, callback)
    },
    [context, threadId]
  )

  const getSnapshot = useCallback(() => {
    if (!threadId) {
      return defaultStreamData
    }

    return context.getStreamData(threadId)
  }, [context, threadId])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useCurrentThread(threadId: string): ThreadRecord {
  const record = useThreadRecordSnapshot(threadId)
  if (!record) {
    throw new Error("useCurrentThread requires a thread id")
  }

  return record
}

export function useThreadState(threadId: string | null): ThreadRecord | null {
  return useThreadRecordSnapshot(threadId)
}

export function useThreadActions(threadId: string | null): ThreadActions | null {
  const context = useThreadContext()

  useEffect(() => {
    if (threadId) {
      context.ensureThreadRuntime(threadId)
    }
  }, [context, threadId])

  if (!threadId) {
    return null
  }

  return context.getThreadActions(threadId)
}

export function useThreadSelector<T>(
  threadId: string | null,
  selector: (record: ThreadRecord | null) => T
): T {
  const context = useThreadContext()

  useEffect(() => {
    if (threadId) {
      context.ensureThreadRuntime(threadId)
    }
  }, [context, threadId])

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
    return selector(threadId ? context.getThreadRecord(threadId) : null)
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

export function useAllStreamLoadingStates(): Record<string, boolean> {
  const context = useThreadContext()
  return useSyncExternalStore(
    context.subscribeAllStreamLoadingStates,
    context.getAllStreamLoadingStates,
    context.getAllStreamLoadingStates
  )
}
