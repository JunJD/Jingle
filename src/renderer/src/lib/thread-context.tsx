import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react"

/* eslint-disable react-refresh/only-export-components */
import type {
  AgentThreadEvent,
  AgentThreadEventBatch,
  AgentThreadSnapshot
} from "@shared/agent-thread-runtime"
import type { ArtifactRecord } from "@shared/artifacts"
import { isPermissionModeName, THREAD_PERMISSION_MODE_METADATA_KEY } from "@shared/permission-mode"
import { historyShellStore } from "./history-shell-store"
import { selectRuntimeEventsAfterRevision } from "./thread-runtime-batch"
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

function getDisplayErrorMessage(errorMessage: string): string {
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

function hasHistoryRefreshEvent(events: AgentThreadEvent[]): boolean {
  return events.some(
    (event) => event.type === "run.finished" || event.type === "approval.requested"
  )
}

function hasForkStateRelevantEvent(events: AgentThreadEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === "run.started" ||
      event.type === "run.resumed" ||
      event.type === "run.finished" ||
      event.type === "approval.requested" ||
      event.type === "approval.cleared"
  )
}

export function ThreadProvider({ children }: { children: ReactNode }) {
  const initializedThreadsRef = useRef<Set<string>>(new Set())
  const runtimeCleanupRef = useRef<Record<string, () => void>>({})
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
  const streamDataRef = useRef<Record<string, StreamData>>({})
  const streamSubscribersRef = useRef<Record<string, Set<() => void>>>({})
  const pendingRuntimeBatchesRef = useRef<Record<string, AgentThreadEventBatch[]>>({})
  const runtimeResyncRef = useRef<Record<string, Promise<void> | null>>({})
  const resyncRuntimeSnapshotRef = useRef<(threadId: string) => Promise<void>>(async () => {})

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

  const syncStreamData = useCallback(
    (threadId: string, isLoading: boolean): void => {
      const messages = threadStore.getThreadState(threadId).messages
      streamDataRef.current[threadId] = {
        isLoading,
        messages,
        stream: null
      }
      threadStore.setStreamLoadingState(threadId, isLoading)
      notifyStreamSubscribers(threadId)
    },
    [notifyStreamSubscribers, threadStore]
  )

  const applyRuntimeSnapshot = useCallback(
    (threadId: string, snapshot: AgentThreadSnapshot): void => {
      const wasLoading = streamDataRef.current[threadId]?.isLoading ?? false
      threadStore.getThreadActions(threadId).applyRuntimeSnapshot({
        ...snapshot,
        error: snapshot.error
          ? {
              ...snapshot.error,
              message: getDisplayErrorMessage(snapshot.error.message)
            }
          : null
      })
      const state = threadStore.getThreadState(threadId)
      const isLoading = Boolean(state.activeRun && state.activeRun.status === "running")
      syncStreamData(threadId, isLoading)

      if (wasLoading && !isLoading) {
        void historyShellStore.getState().loadThreads()
      }
    },
    [syncStreamData, threadStore]
  )

  const applyRuntimeEvents = useCallback(
    (threadId: string, events: AgentThreadEvent[]): void => {
      if (events.length === 0) {
        return
      }

      const wasLoading = streamDataRef.current[threadId]?.isLoading ?? false
      threadStore.getThreadActions(threadId).applyRuntimeEvents(
        events.map((event) =>
          event.type === "thread.statusChanged" && event.error
            ? {
                ...event,
                error: {
                  ...event.error,
                  message: getDisplayErrorMessage(event.error.message)
                }
              }
            : event
        )
      )
      const state = threadStore.getThreadState(threadId)
      const isLoading = Boolean(state.activeRun && state.activeRun.status === "running")
      syncStreamData(threadId, isLoading)

      if (wasLoading && !isLoading && hasHistoryRefreshEvent(events)) {
        void historyShellStore.getState().loadThreads()
      }

      if (wasLoading !== isLoading || hasForkStateRelevantEvent(events)) {
        void refreshThreadForkState(threadId)
      }
    },
    [refreshThreadForkState, syncStreamData, threadStore]
  )

  const drainPendingRuntimeBatches = useCallback(
    (threadId: string): void => {
      const batches = pendingRuntimeBatchesRef.current[threadId]
      if (!batches || batches.length === 0 || runtimeResyncRef.current[threadId]) {
        return
      }

      delete pendingRuntimeBatchesRef.current[threadId]
      for (const batch of batches) {
        const currentRevision = threadStore.getThreadState(batch.threadId).revision
        const selection = selectRuntimeEventsAfterRevision(currentRevision, batch)
        if (selection.type === "events") {
          applyRuntimeEvents(batch.threadId, selection.events)
          continue
        }

        if (selection.type === "gap") {
          console.warn("[ThreadContext] Runtime event gap detected; resyncing thread snapshot.", {
            actualRevision: selection.actualRevision,
            expectedRevision: selection.expectedRevision,
            threadId: batch.threadId
          })
          void resyncRuntimeSnapshotRef.current(batch.threadId)
          return
        }
      }
    },
    [applyRuntimeEvents, threadStore]
  )

  const resyncRuntimeSnapshot = useCallback(
    async (threadId: string): Promise<void> => {
      if (runtimeResyncRef.current[threadId]) {
        await runtimeResyncRef.current[threadId]
        return
      }

      const resync = window.api.agent
        .getThreadSnapshot(threadId)
        .then((snapshot) => {
          applyRuntimeSnapshot(threadId, snapshot)
        })
        .catch((error) => {
          console.error("[ThreadContext] Failed to resync thread runtime:", error)
        })
        .finally(() => {
          runtimeResyncRef.current[threadId] = null
          drainPendingRuntimeBatches(threadId)
        })

      runtimeResyncRef.current[threadId] = resync
      await resync
    },
    [applyRuntimeSnapshot, drainPendingRuntimeBatches]
  )

  useEffect(() => {
    resyncRuntimeSnapshotRef.current = resyncRuntimeSnapshot
  }, [resyncRuntimeSnapshot])

  const applyRuntimeBatch = useCallback(
    (batch: AgentThreadEventBatch): void => {
      if (runtimeResyncRef.current[batch.threadId]) {
        const batches = pendingRuntimeBatchesRef.current[batch.threadId] ?? []
        batches.push(batch)
        pendingRuntimeBatchesRef.current[batch.threadId] = batches
        return
      }

      const currentRevision = threadStore.getThreadState(batch.threadId).revision
      const selection = selectRuntimeEventsAfterRevision(currentRevision, batch)
      if (selection.type === "events") {
        applyRuntimeEvents(batch.threadId, selection.events)
        return
      }

      if (selection.type === "gap") {
        console.warn("[ThreadContext] Runtime event gap detected; resyncing thread snapshot.", {
          actualRevision: selection.actualRevision,
          expectedRevision: selection.expectedRevision,
          threadId: batch.threadId
        })
        void resyncRuntimeSnapshot(batch.threadId)
      }
    },
    [applyRuntimeEvents, resyncRuntimeSnapshot, threadStore]
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

  const subscribeToAllStreams = useCallback(() => {
    return () => {}
  }, [])

  const ensureThreadRuntime = useCallback(
    (threadId: string): void => {
      if (initializedThreadsRef.current.has(threadId)) {
        return
      }

      initializedThreadsRef.current.add(threadId)
      threadStore.ensureThreadState(threadId)
      runtimeCleanupRef.current[threadId] = window.api.agent.subscribeThreadEvents(
        threadId,
        (batch) => {
          applyRuntimeBatch(batch)
        },
        (snapshot) => {
          applyRuntimeSnapshot(threadId, snapshot)
        }
      )
    },
    [applyRuntimeBatch, applyRuntimeSnapshot, threadStore]
  )

  const cleanupThread = useCallback(
    (threadId: string): void => {
      initializedThreadsRef.current.delete(threadId)
      runtimeCleanupRef.current[threadId]?.()
      delete runtimeCleanupRef.current[threadId]
      delete pendingRuntimeBatchesRef.current[threadId]
      delete runtimeResyncRef.current[threadId]
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
        const snapshot = await window.api.agent.getThreadSnapshot(threadId)
        applyRuntimeSnapshot(threadId, snapshot)
        const runtimeState = await window.api.threads.getRuntimeState(threadId)
        actions.setForkState(runtimeState.forkState)
      } catch (error) {
        console.error("[ThreadContext] Failed to load thread runtime:", error)
      }
    },
    [applyRuntimeSnapshot, getThreadActions, threadStore]
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
