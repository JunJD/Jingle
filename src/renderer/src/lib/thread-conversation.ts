import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { useThreadContext, useThreadState } from "./thread-context"
import type { HITLRequest, Message } from "@/types"

interface AgentStreamValues {
  todos?: Array<{ id?: string; content?: string; status?: string }>
}

interface StreamMessage {
  id?: string
  type?: string
  content?: Message["content"]
  tool_calls?: Message["tool_calls"]
  tool_call_id?: string
  metadata?: Message["metadata"]
  name?: string
}

export interface ToolResultInfo {
  content: string | unknown
}

const EMPTY_STREAM_DATA = {
  messages: [],
  isLoading: false,
  stream: null
} as const
const EMPTY_THREAD_MESSAGES: Message[] = []

function toThreadMessage(message: StreamMessage & { id: string }): Message {
  let role: Message["role"] = "assistant"
  if (message.type === "human") role = "user"
  else if (message.type === "tool") role = "tool"
  else if (message.type === "ai") role = "assistant"

  return {
    id: message.id,
    role,
    content:
      typeof message.content === "string" || Array.isArray(message.content) ? message.content : "",
    tool_calls: message.tool_calls,
    metadata: message.metadata,
    ...(role === "tool" && message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(role === "tool" && message.name ? { name: message.name } : {}),
    created_at: new Date()
  }
}

export interface ThreadConversationProjection {
  clearError: () => void
  displayMessages: Message[]
  error: string | null
  isLoading: boolean
  pendingApproval: HITLRequest | null
  resumePendingApproval: (decision: "approve" | "reject" | "edit") => Promise<void>
  stream: ReturnType<ReturnType<typeof useThreadContext>["getStreamData"]>["stream"]
  threadState: ReturnType<typeof useThreadState>
  todos: NonNullable<ReturnType<typeof useThreadState>>["todos"]
  toolResults: Map<string, ToolResultInfo>
}

export function useThreadConversationProjection(
  threadId: string | null,
  options?: {
    onMessagesPersisted?: () => void
  }
): ThreadConversationProjection {
  const context = useThreadContext()
  const threadState = useThreadState(threadId)
  const onMessagesPersistedRef = useRef(options?.onMessagesPersisted)
  const prevLoadingRef = useRef(false)
  const threadMessages = threadState?.messages ?? EMPTY_THREAD_MESSAGES
  const pendingApproval = threadState?.pendingApproval ?? null
  const todos = threadState?.todos ?? []
  const error = threadState?.error ?? null
  const currentModel = threadState?.currentModel ?? null
  const appendMessage = threadState?.appendMessage
  const setPendingApproval = threadState?.setPendingApproval
  const setTodos = threadState?.setTodos
  const clearError = threadState?.clearError

  useEffect(() => {
    onMessagesPersistedRef.current = options?.onMessagesPersisted
  }, [options?.onMessagesPersisted])

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
      return EMPTY_STREAM_DATA
    }

    return context.getStreamData(threadId)
  }, [context, threadId])

  const streamData = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const stream = streamData.stream
  const isLoading = streamData.isLoading

  const streamTodos = (stream?.values as AgentStreamValues | undefined)?.todos
  useEffect(() => {
    if (!setTodos || !Array.isArray(streamTodos)) {
      return
    }

    setTodos(
      streamTodos.map((todo) => ({
        id: todo.id || crypto.randomUUID(),
        content: todo.content || "",
        status: (todo.status || "pending") as "pending" | "in_progress" | "completed" | "cancelled"
      }))
    )
  }, [setTodos, streamTodos])

  useEffect(() => {
    if (!appendMessage) {
      prevLoadingRef.current = false
      return
    }

    if (!prevLoadingRef.current || isLoading) {
      prevLoadingRef.current = isLoading
      return
    }

    for (const rawMessage of streamData.messages) {
      const message = rawMessage as StreamMessage
      if (!message.id) {
        continue
      }

      appendMessage(toThreadMessage(message as StreamMessage & { id: string }))
    }

    onMessagesPersistedRef.current?.()
    prevLoadingRef.current = false
  }, [appendMessage, isLoading, streamData.messages])

  useEffect(() => {
    if (isLoading) {
      prevLoadingRef.current = true
    }
  }, [isLoading])

  const displayMessages = useMemo(() => {
    if (!appendMessage) {
      return []
    }

    if (!isLoading) {
      return threadMessages
    }

    const threadMessageIds = new Set(threadMessages.map((message) => message.id))

    const streamingMessages: Message[] = (streamData.messages as StreamMessage[])
      .filter((message): message is StreamMessage & { id: string } => {
        return Boolean(message.id) && !threadMessageIds.has(message.id!)
      })
      .map((message) => toThreadMessage(message))

    return [...threadMessages, ...streamingMessages]
  }, [appendMessage, isLoading, streamData.messages, threadMessages])

  const toolResults = useMemo(() => {
    const results = new Map<string, ToolResultInfo>()

    for (const message of displayMessages) {
      if (message.role === "tool" && message.tool_call_id) {
        results.set(message.tool_call_id, {
          content: message.content
        })
      }
    }

    return results
  }, [displayMessages])

  const resumePendingApproval = useCallback(
    async (decision: "approve" | "reject" | "edit"): Promise<void> => {
      if (!threadId || !pendingApproval || !stream || !setPendingApproval || !currentModel) {
        return
      }

      setPendingApproval(null)

      try {
        await stream.submit(null, {
          command: { resume: { decision } },
          config: {
            configurable: {
              model_id: currentModel,
              thread_id: threadId
            }
          }
        })
      } catch (resumeError) {
        console.error("[ThreadConversation] Resume command failed:", resumeError)
      }
    },
    [currentModel, pendingApproval, setPendingApproval, stream, threadId]
  )

  return {
    clearError: clearError ?? (() => {}),
    displayMessages,
    error,
    isLoading,
    pendingApproval,
    resumePendingApproval,
    stream,
    threadState,
    todos,
    toolResults
  }
}
