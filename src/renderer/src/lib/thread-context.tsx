import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
  useSyncExternalStore,
  type ReactNode
} from "react"

/* eslint-disable react-refresh/only-export-components */
import { useStream } from "@langchain/langgraph-sdk/react"
import type { DeepAgent } from "deepagents"
import { ElectronIPCTransport } from "./electron-transport"
import { getIpcErrorDisplayMessage, getIpcErrorPayload } from "./ipc-errors"
import type { HITLRequest } from "@/types"
import type { ArtifactRecord } from "@shared/artifacts"
import {
  createThreadStore,
  type ThreadActions,
  type ThreadRecord,
  type ThreadState
} from "./thread-store-core"

export type { OpenArtifactTab, OpenFile } from "@shared/thread-tabs"
export type { ThreadActions, ThreadRecord, ThreadState, TokenUsage } from "./thread-store-core"
export { getArtifactTabId } from "@shared/thread-tabs"

// Stream instance type
type StreamInstance = ReturnType<typeof useStream<DeepAgent>>

// Stream data that we want to be reactive
interface StreamData {
  messages: StreamInstance["messages"]
  isLoading: boolean
  stream: StreamInstance | null
}

// Context value
export interface ThreadContextValue {
  getThreadRecord: (threadId: string) => ThreadRecord
  getThreadState: (threadId: string) => ThreadState
  getThreadActions: (threadId: string) => ThreadActions
  ensureThreadRuntime: (threadId: string) => void
  cleanupThread: (threadId: string) => void
  reloadThread: (threadId: string) => Promise<void>
  subscribeThread: (threadId: string, callback: () => void) => () => void
  // Stream subscription
  subscribeToStream: (threadId: string, callback: () => void) => () => void
  getStreamData: (threadId: string) => StreamData
  // Get all initialized thread states (for kanban view)
  getAllThreadStates: () => Record<string, ThreadState>
  subscribeAllThreadStates: (callback: () => void) => () => void
  // Get all stream loading states (for kanban view)
  getAllStreamLoadingStates: () => Record<string, boolean>
  subscribeAllStreamLoadingStates: (callback: () => void) => () => void
  // Subscribe to all stream updates
  subscribeToAllStreams: (callback: () => void) => () => void
}

const defaultStreamData: StreamData = {
  messages: [],
  isLoading: false,
  stream: null
}

const ThreadContext = createContext<ThreadContextValue | null>(null)

// Custom event types from the stream
interface CustomEventData {
  artifacts?: ArtifactRecord[]
  type?: string
  request?: HITLRequest
  subagents?: Array<{
    id?: string
    name?: string
    description?: string
    status?: string
    startedAt?: Date
    completedAt?: Date
  }>
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
  }
}

// Component that holds a stream and notifies subscribers
function ThreadStreamHolder({
  threadId,
  onStreamUpdate,
  onCustomEvent,
  onError
}: {
  threadId: string
  onStreamUpdate: (data: StreamData) => void
  onCustomEvent: (data: CustomEventData) => void
  onError: (error: Error) => void
}): null {
  const transport = useMemo(() => new ElectronIPCTransport(), [])

  // Use refs to avoid stale closures
  const onCustomEventRef = useRef(onCustomEvent)
  useEffect(() => {
    onCustomEventRef.current = onCustomEvent
  })

  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  })

  const stream = useStream<DeepAgent>({
    transport,
    threadId,
    messagesKey: "messages",
    onCustomEvent: (data) => {
      onCustomEventRef.current(data as CustomEventData)
    },
    onError: (error: unknown) => {
      onErrorRef.current(error instanceof Error ? error : new Error(String(error)))
    }
  })

  // Notify parent whenever stream data changes
  // Use refs to avoid stale closures and ensure we always have latest callback
  const onStreamUpdateRef = useRef(onStreamUpdate)
  useEffect(() => {
    onStreamUpdateRef.current = onStreamUpdate
  })

  // Track previous values to detect actual changes
  const prevMessagesRef = useRef(stream.messages)
  const prevIsLoadingRef = useRef(stream.isLoading)

  // Always sync on mount and when values actually change
  useEffect(() => {
    const messagesChanged = prevMessagesRef.current !== stream.messages
    const loadingChanged = prevIsLoadingRef.current !== stream.isLoading

    if (messagesChanged || loadingChanged || !prevMessagesRef.current) {
      prevMessagesRef.current = stream.messages
      prevIsLoadingRef.current = stream.isLoading

      onStreamUpdateRef.current({
        messages: stream.messages,
        isLoading: stream.isLoading,
        stream
      })
    }
  })

  // Also sync immediately when stream instance changes
  useEffect(() => {
    onStreamUpdateRef.current({
      messages: stream.messages,
      isLoading: stream.isLoading,
      stream
    })
  }, [stream])

  return null
}

export function ThreadProvider({ children }: { children: ReactNode }) {
  const [activeThreadIds, setActiveThreadIds] = useState<Set<string>>(new Set())
  const initializedThreadsRef = useRef<Set<string>>(new Set())
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
      }
    })
  )
  const threadStore = threadStoreRef.current

  // Stream data store (not React state - we use subscriptions)
  const streamDataRef = useRef<Record<string, StreamData>>({})
  const streamSubscribersRef = useRef<Record<string, Set<() => void>>>({})

  // Notify subscribers for a thread
  const notifyStreamSubscribers = useCallback((threadId: string) => {
    const subscribers = streamSubscribersRef.current[threadId]
    if (subscribers) {
      subscribers.forEach((callback) => callback())
    }
  }, [])

  // Handle stream updates from ThreadStreamHolder
  const handleStreamUpdate = useCallback(
    (threadId: string, data: StreamData) => {
      streamDataRef.current[threadId] = data
      notifyStreamSubscribers(threadId)
      threadStore.setStreamLoadingState(threadId, data.isLoading)
    },
    [notifyStreamSubscribers, threadStore]
  )

  // Subscribe to stream updates for a thread
  const subscribeToStream = useCallback((threadId: string, callback: () => void) => {
    if (!streamSubscribersRef.current[threadId]) {
      streamSubscribersRef.current[threadId] = new Set()
    }
    streamSubscribersRef.current[threadId].add(callback)

    return () => {
      streamSubscribersRef.current[threadId]?.delete(callback)
    }
  }, [])

  // Get current stream data for a thread
  const getStreamData = useCallback((threadId: string): StreamData => {
    return streamDataRef.current[threadId] || defaultStreamData
  }, [])

  const subscribeToAllStreams = useCallback(() => {
    return () => {}
  }, [])

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
  // Parse error messages into user-friendly format
  const parseErrorMessage = useCallback((error: Error | string): string => {
    const ipcError = getIpcErrorPayload(error)
    const errorMessage = ipcError?.message ?? getIpcErrorDisplayMessage(error, "Unknown error")

    // Check for context window exceeded errors
    const contextWindowMatch = errorMessage.match(
      /prompt is too long: (\d+) tokens > (\d+) maximum/i
    )
    if (contextWindowMatch) {
      const [, usedTokens, maxTokens] = contextWindowMatch
      const usedK = Math.round(parseInt(usedTokens) / 1000)
      const maxK = Math.round(parseInt(maxTokens) / 1000)
      return `Context window exceeded (${usedK}K / ${maxK}K tokens). The conversation history is too long. Please start a new thread to continue.`
    }

    // Check for rate limit errors
    if (errorMessage.includes("rate_limit") || errorMessage.includes("429")) {
      return "Rate limit exceeded. Please wait a moment before sending another message."
    }

    // Check for authentication errors
    if (
      errorMessage.includes("401") ||
      errorMessage.includes("invalid_api_key") ||
      errorMessage.includes("authentication")
    ) {
      return "Authentication failed. Please check your API key in settings."
    }

    // Return the original message for other errors
    return errorMessage
  }, [])

  // Handle errors from ThreadStreamHolder
  const handleError = useCallback(
    (threadId: string, error: Error) => {
      console.error("[ThreadContext] Stream error:", { threadId, error })
      const userFriendlyMessage = parseErrorMessage(error)
      threadStore.updateThreadState(threadId, () => ({ error: userFriendlyMessage }))
    },
    [parseErrorMessage, threadStore]
  )

  // Handle custom events from ThreadStreamHolder (interrupts, subagents, token usage)
  const handleCustomEvent = useCallback(
    (threadId: string, data: CustomEventData) => {
      console.log("[ThreadContext] Custom event received:", { threadId, type: data.type, data })
      switch (data.type) {
        case "interrupt":
          if (data.request) {
            console.log(
              "[ThreadContext] Setting pendingApproval for thread:",
              threadId,
              data.request
            )
            threadStore.updateThreadState(threadId, () => ({ pendingApproval: data.request }))
          }
          break
        case "artifacts":
          if (Array.isArray(data.artifacts)) {
            threadStore.getThreadActions(threadId).setArtifacts(data.artifacts)
          }
          break
        case "subagents":
          if (Array.isArray(data.subagents)) {
            threadStore.updateThreadState(threadId, () => ({
              subagents: data.subagents!.map((s) => ({
                id: s.id || crypto.randomUUID(),
                name: s.name || "Subagent",
                description: s.description || "",
                status: (s.status || "pending") as "pending" | "running" | "completed" | "failed",
                startedAt: s.startedAt,
                completedAt: s.completedAt
              }))
            }))
          }
          break
        case "token_usage":
          // Only update if we have meaningful token values (> 0)
          // This prevents resetting the usage when streaming ends
          if (data.usage && data.usage.inputTokens !== undefined && data.usage.inputTokens > 0) {
            console.log("[ThreadContext] Token usage update:", {
              threadId,
              inputTokens: data.usage.inputTokens,
              outputTokens: data.usage.outputTokens,
              totalTokens: data.usage.totalTokens
            })
            threadStore.updateThreadState(threadId, (prev) => {
              // Keep the higher of previous or new input tokens
              // This ensures we don't lose accumulated context during tool calls
              const newInputTokens = data.usage!.inputTokens || 0
              const prevInputTokens = prev.tokenUsage?.inputTokens || 0

              // Always update if new value is higher, or if this is first update
              if (newInputTokens >= prevInputTokens || !prev.tokenUsage) {
                return {
                  tokenUsage: {
                    inputTokens: newInputTokens,
                    outputTokens: data.usage!.outputTokens || 0,
                    totalTokens: data.usage!.totalTokens || 0,
                    cacheReadTokens: data.usage!.cacheReadTokens,
                    cacheCreationTokens: data.usage!.cacheCreationTokens,
                    lastUpdated: new Date()
                  }
                }
              }
              // Keep existing token usage if new value is lower
              return {}
            })
          }
          break
      }
    },
    [threadStore]
  )

  const loadThreadHistory = useCallback(
    async (threadId: string) => {
      const actions = getThreadActions(threadId)

      // Load workspace path and thread metadata
      try {
        const thread = await window.api.threads.get(threadId)
        if (thread) {
          const metadata = thread.metadata || {}
          if (metadata.workspacePath) {
            actions.setWorkspacePath(metadata.workspacePath as string)
          }
          if (metadata.model) {
            // Update state directly to avoid triggering persistence in setCurrentModel
            threadStore.updateThreadState(threadId, () => ({
              currentModel: metadata.model as string
            }))
          }
        }
      } catch (error) {
        console.error("[ThreadContext] Failed to load thread details:", error)
      }

      // Bootstrap thread state directly from the latest checkpoint-backed runtime snapshot.
      try {
        const history = await window.api.threads.getHistory(threadId)
        actions.setArtifacts(history.artifacts)
        actions.setMessages(history.messages)
        actions.setTodos(history.todos)
        actions.setPendingApproval(history.pendingApproval)
      } catch (error) {
        console.error("[ThreadContext] Failed to load checkpoint-backed thread state:", error)
      }
    },
    [getThreadActions, threadStore]
  )

  const ensureThreadRuntime = useCallback(
    (threadId: string) => {
      if (initializedThreadsRef.current.has(threadId)) {
        return
      }

      initializedThreadsRef.current.add(threadId)
      threadStore.ensureThreadState(threadId)

      // Add to active threads (this will render a ThreadStreamHolder)
      setActiveThreadIds((prev) => new Set([...prev, threadId]))
    },
    [threadStore]
  )

  const cleanupThread = useCallback(
    (threadId: string) => {
      initializedThreadsRef.current.delete(threadId)
      delete streamDataRef.current[threadId]
      delete streamSubscribersRef.current[threadId]
      threadStore.deleteThreadState(threadId)
      setActiveThreadIds((prev) => {
        const next = new Set(prev)
        next.delete(threadId)
        return next
      })
    },
    [threadStore]
  )

  const reloadThread = useCallback(
    async (threadId: string) => {
      if (!initializedThreadsRef.current.has(threadId)) {
        ensureThreadRuntime(threadId)
      }

      await loadThreadHistory(threadId)
    },
    [ensureThreadRuntime, loadThreadHistory]
  )

  useEffect(() => {
    return window.api.artifacts.onChanged(({ artifacts, threadId }) => {
      handleCustomEvent(threadId, {
        artifacts,
        type: "artifacts"
      })
    })
  }, [handleCustomEvent])

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
    ]
  )

  return (
    <ThreadContext.Provider value={contextValue}>
      {/* Render stream holders for all active threads */}
      {Array.from(activeThreadIds).map((threadId) => (
        <ThreadStreamHolder
          key={threadId}
          threadId={threadId}
          onStreamUpdate={(data) => handleStreamUpdate(threadId, data)}
          onCustomEvent={(data) => handleCustomEvent(threadId, data)}
          onError={(error) => handleError(threadId, error)}
        />
      ))}
      {children}
    </ThreadContext.Provider>
  )
}

export function useThreadContext(): ThreadContextValue {
  const context = useContext(ThreadContext)
  if (!context) throw new Error("useThreadContext must be used within a ThreadProvider")
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

// Hook to subscribe to stream data for a thread using useSyncExternalStore
export function useThreadStream(threadId: string): StreamData {
  const context = useThreadContext()

  const subscribe = useCallback(
    (callback: () => void) => context.subscribeToStream(threadId, callback),
    [context, threadId]
  )

  const getSnapshot = useCallback(() => context.getStreamData(threadId), [context, threadId])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// Hook to access current thread's state and actions
export function useCurrentThread(threadId: string): ThreadRecord {
  const record = useThreadRecordSnapshot(threadId)
  if (!record) {
    throw new Error("useCurrentThread requires a thread id")
  }

  return record
}

// Hook for nullable threadId
export function useThreadState(threadId: string | null): ThreadRecord | null {
  return useThreadRecordSnapshot(threadId)
}

export function useThreadActions(threadId: string | null): ThreadActions | null {
  const context = useThreadContext()

  useEffect(() => {
    if (threadId) {
      context.ensureThreadRuntime(threadId)
    }
  }, [threadId, context])

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

// Hook to get all initialized thread states (for kanban view)
export function useAllThreadStates(): Record<string, ThreadState> {
  const context = useThreadContext()
  return useSyncExternalStore(
    context.subscribeAllThreadStates,
    context.getAllThreadStates,
    context.getAllThreadStates
  )
}

// Hook to get all stream loading states with reactivity
export function useAllStreamLoadingStates(): Record<string, boolean> {
  const context = useThreadContext()
  return useSyncExternalStore(
    context.subscribeAllStreamLoadingStates,
    context.getAllStreamLoadingStates,
    context.getAllStreamLoadingStates
  )
}
