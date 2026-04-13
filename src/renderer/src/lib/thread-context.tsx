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
import type { Message, Todo, Subagent, HITLRequest } from "@/types"
import { DEFAULT_MODEL_ID } from "../../../shared/models"
import type { ArtifactRecord } from "@shared/artifacts"

// Open file tab type
export interface OpenFile {
  path: string
  name: string
}

// Token usage tracking for context window monitoring
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  lastUpdated: Date
}

// Per-thread state (persisted/restored from checkpoints)
export interface ThreadState {
  artifacts: ArtifactRecord[]
  messages: Message[]
  todos: Todo[]
  workspacePath: string | null
  subagents: Subagent[]
  pendingApproval: HITLRequest | null
  error: string | null
  currentModel: string
  openFiles: OpenFile[]
  activeTab: "agent" | string
  fileContents: Record<string, string>
  tokenUsage: TokenUsage | null
  draftInput: string
}

// Stream instance type
type StreamInstance = ReturnType<typeof useStream<DeepAgent>>

// Stream data that we want to be reactive
interface StreamData {
  messages: StreamInstance["messages"]
  isLoading: boolean
  stream: StreamInstance | null
}

// Actions available on a thread
export interface ThreadActions {
  setArtifacts: (artifacts: ArtifactRecord[]) => void
  appendMessage: (message: Message) => void
  setMessages: (messages: Message[]) => void
  setTodos: (todos: Todo[]) => void
  setWorkspacePath: (path: string | null) => void
  setSubagents: (subagents: Subagent[]) => void
  setPendingApproval: (request: HITLRequest | null) => void
  setError: (error: string | null) => void
  clearError: () => void
  setCurrentModel: (modelId: string) => void
  openFile: (path: string, name: string) => void
  closeFile: (path: string) => void
  setActiveTab: (tab: "agent" | string) => void
  setFileContents: (path: string, content: string) => void
  setDraftInput: (input: string) => void
}

// Context value
export interface ThreadContextValue {
  getThreadState: (threadId: string) => ThreadState
  getThreadActions: (threadId: string) => ThreadActions
  ensureThreadRuntime: (threadId: string) => void
  cleanupThread: (threadId: string) => void
  reloadThread: (threadId: string) => Promise<void>
  // Stream subscription
  subscribeToStream: (threadId: string, callback: () => void) => () => void
  getStreamData: (threadId: string) => StreamData
  // Get all initialized thread states (for kanban view)
  getAllThreadStates: () => Record<string, ThreadState>
  // Get all stream loading states (for kanban view)
  getAllStreamLoadingStates: () => Record<string, boolean>
  // Subscribe to all stream updates
  subscribeToAllStreams: (callback: () => void) => () => void
}

// Default thread state
const createDefaultThreadState = (): ThreadState => ({
  artifacts: [],
  messages: [],
  todos: [],
  workspacePath: null,
  subagents: [],
  pendingApproval: null,
  error: null,
  currentModel: DEFAULT_MODEL_ID,
  openFiles: [],
  activeTab: "agent",
  fileContents: {},
  tokenUsage: null,
  draftInput: ""
})

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
  const [threadStates, setThreadStates] = useState<Record<string, ThreadState>>({})
  const [activeThreadIds, setActiveThreadIds] = useState<Set<string>>(new Set())
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({})
  const initializedThreadsRef = useRef<Set<string>>(new Set())
  const actionsCache = useRef<Record<string, ThreadActions>>({})

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
      // Update loading states for kanban view
      setLoadingStates((prev) => {
        if (prev[threadId] === data.isLoading) return prev
        return { ...prev, [threadId]: data.isLoading }
      })
    },
    [notifyStreamSubscribers]
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

  const getThreadState = useCallback(
    (threadId: string): ThreadState => {
      const state = threadStates[threadId] || createDefaultThreadState()
      if (state.pendingApproval) {
        console.log(
          "[ThreadContext] getThreadState returning pendingApproval for:",
          threadId,
          state.pendingApproval
        )
      }
      return state
    },
    [threadStates]
  )

  const getAllThreadStates = useCallback((): Record<string, ThreadState> => {
    return threadStates
  }, [threadStates])

  const getAllStreamLoadingStates = useCallback((): Record<string, boolean> => {
    return loadingStates
  }, [loadingStates])

  const subscribeToAllStreams = useCallback(() => {
    return () => {}
  }, [])

  const updateThreadState = useCallback(
    (threadId: string, updater: (prev: ThreadState) => Partial<ThreadState>) => {
      setThreadStates((prev) => {
        const currentState = prev[threadId] || createDefaultThreadState()
        const updates = updater(currentState)
        return {
          ...prev,
          [threadId]: { ...currentState, ...updates }
        }
      })
    },
    []
  )

  // Parse error messages into user-friendly format
  const parseErrorMessage = useCallback((error: Error | string): string => {
    const errorMessage = typeof error === "string" ? error : error.message

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
      updateThreadState(threadId, () => ({ error: userFriendlyMessage }))
    },
    [parseErrorMessage, updateThreadState]
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
            updateThreadState(threadId, () => ({ pendingApproval: data.request }))
          }
          break
        case "artifacts":
          if (Array.isArray(data.artifacts)) {
            updateThreadState(threadId, () => ({ artifacts: data.artifacts! }))
          }
          break
        case "subagents":
          if (Array.isArray(data.subagents)) {
            updateThreadState(threadId, () => ({
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
            updateThreadState(threadId, (prev) => {
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
    [updateThreadState]
  )

  const getThreadActions = useCallback(
    (threadId: string): ThreadActions => {
      if (actionsCache.current[threadId]) {
        return actionsCache.current[threadId]
      }

      const actions: ThreadActions = {
        appendMessage: (message: Message) => {
          updateThreadState(threadId, (state) => {
            const exists = state.messages.some((m) => m.id === message.id)
            if (exists) {
              return { messages: state.messages.map((m) => (m.id === message.id ? message : m)) }
            }
            return { messages: [...state.messages, message] }
          })
        },
        setMessages: (messages: Message[]) => {
          updateThreadState(threadId, () => ({ messages }))
        },
        setArtifacts: (artifacts: ArtifactRecord[]) => {
          updateThreadState(threadId, () => ({ artifacts }))
        },
        setTodos: (todos: Todo[]) => {
          updateThreadState(threadId, () => ({ todos }))
        },
        setWorkspacePath: (path: string | null) => {
          updateThreadState(threadId, () => ({ workspacePath: path }))
        },
        setSubagents: (subagents: Subagent[]) => {
          updateThreadState(threadId, () => ({ subagents }))
        },
        setPendingApproval: (request: HITLRequest | null) => {
          updateThreadState(threadId, () => ({ pendingApproval: request }))
        },
        setError: (error: string | null) => {
          updateThreadState(threadId, () => ({ error }))
        },
        clearError: () => {
          updateThreadState(threadId, () => ({ error: null }))
        },
        setCurrentModel: (modelId: string) => {
          updateThreadState(threadId, () => ({ currentModel: modelId }))
          // Persist to backend
          window.api.threads.get(threadId).then((thread) => {
            if (thread) {
              const metadata = thread.metadata || {}
              window.api.threads.update(threadId, {
                metadata: { ...metadata, model: modelId }
              })
            }
          })
        },
        openFile: (path: string, name: string) => {
          updateThreadState(threadId, (state) => {
            if (state.openFiles.some((f) => f.path === path)) {
              return { activeTab: path }
            }
            return { openFiles: [...state.openFiles, { path, name }], activeTab: path }
          })
        },
        closeFile: (path: string) => {
          updateThreadState(threadId, (state) => {
            const newOpenFiles = state.openFiles.filter((f) => f.path !== path)
            const newFileContents = { ...state.fileContents }
            delete newFileContents[path]
            let newActiveTab = state.activeTab
            if (state.activeTab === path) {
              const closedIndex = state.openFiles.findIndex((f) => f.path === path)
              if (newOpenFiles.length === 0) newActiveTab = "agent"
              else if (closedIndex > 0) newActiveTab = newOpenFiles[closedIndex - 1].path
              else newActiveTab = newOpenFiles[0].path
            }
            return {
              openFiles: newOpenFiles,
              activeTab: newActiveTab,
              fileContents: newFileContents
            }
          })
        },
        setActiveTab: (tab: "agent" | string) => {
          updateThreadState(threadId, () => ({ activeTab: tab }))
        },
        setFileContents: (path: string, content: string) => {
          updateThreadState(threadId, (state) => ({
            fileContents: { ...state.fileContents, [path]: content }
          }))
        },
        setDraftInput: (input: string) => {
          updateThreadState(threadId, () => ({ draftInput: input }))
        }
      }

      actionsCache.current[threadId] = actions
      return actions
    },
    [updateThreadState]
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
            updateThreadState(threadId, () => ({ currentModel: metadata.model as string }))
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
    [getThreadActions, updateThreadState]
  )

  const ensureThreadRuntime = useCallback((threadId: string) => {
    if (initializedThreadsRef.current.has(threadId)) return
    initializedThreadsRef.current.add(threadId)

    // Add to active threads (this will render a ThreadStreamHolder)
    setActiveThreadIds((prev) => new Set([...prev, threadId]))

    setThreadStates((prev) => {
      if (prev[threadId]) return prev
      return { ...prev, [threadId]: createDefaultThreadState() }
    })
  }, [])

  const cleanupThread = useCallback((threadId: string) => {
    initializedThreadsRef.current.delete(threadId)
    delete actionsCache.current[threadId]
    delete streamDataRef.current[threadId]
    delete streamSubscribersRef.current[threadId]
    setActiveThreadIds((prev) => {
      const next = new Set(prev)
      next.delete(threadId)
      return next
    })
    setThreadStates((prev) => {
      const { [threadId]: _removed, ...rest } = prev
      void _removed // Explicitly mark as intentionally unused
      return rest
    })
  }, [])

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
      getThreadState,
      getThreadActions,
      ensureThreadRuntime,
      cleanupThread,
      reloadThread,
      subscribeToStream,
      getStreamData,
      getAllThreadStates,
      getAllStreamLoadingStates,
      subscribeToAllStreams
    }),
    [
      getThreadState,
      getThreadActions,
      ensureThreadRuntime,
      cleanupThread,
      reloadThread,
      subscribeToStream,
      getStreamData,
      getAllThreadStates,
      getAllStreamLoadingStates,
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
export function useCurrentThread(threadId: string): ThreadState & ThreadActions {
  const context = useThreadContext()

  useEffect(() => {
    context.ensureThreadRuntime(threadId)
  }, [threadId, context])

  const state = context.getThreadState(threadId)
  const actions = context.getThreadActions(threadId)

  return { ...state, ...actions }
}

// Hook for nullable threadId
export function useThreadState(threadId: string | null): (ThreadState & ThreadActions) | null {
  const context = useThreadContext()

  useEffect(() => {
    if (threadId) context.ensureThreadRuntime(threadId)
  }, [threadId, context])

  if (!threadId) return null

  const state = context.getThreadState(threadId)
  const actions = context.getThreadActions(threadId)

  return { ...state, ...actions }
}

// Hook to get all initialized thread states (for kanban view)
export function useAllThreadStates(): Record<string, ThreadState> {
  const context = useThreadContext()
  return context.getAllThreadStates()
}

// Hook to get all stream loading states with reactivity
export function useAllStreamLoadingStates(): Record<string, boolean> {
  const context = useThreadContext()
  return context.getAllStreamLoadingStates()
}
