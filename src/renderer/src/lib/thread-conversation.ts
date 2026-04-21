import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { useThreadActions, useThreadContext, useThreadSelector } from "./thread-context"
import type { HITLDecision, HITLRequest, Message, Todo } from "@/types"

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
const EMPTY_TODOS: Todo[] = []

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
  resumePendingApproval: (decision: HITLDecision) => Promise<void>
  stream: ReturnType<ReturnType<typeof useThreadContext>["getStreamData"]>["stream"]
  todos: Todo[]
  toolResults: Map<string, ToolResultInfo>
}

export function useThreadConversationProjection(
  threadId: string | null,
  options?: {
    onMessagesPersisted?: () => void
  }
): ThreadConversationProjection {
  const context = useThreadContext()
  const threadActions = useThreadActions(threadId)
  const onMessagesPersistedRef = useRef(options?.onMessagesPersisted)
  const prevLoadingRef = useRef(false)
  const threadMessages = useThreadSelector(
    threadId,
    (state) => state?.messages ?? EMPTY_THREAD_MESSAGES
  )
  const pendingApproval = useThreadSelector(threadId, (state) => state?.pendingApproval ?? null)
  const todos = useThreadSelector(threadId, (state) => state?.todos ?? EMPTY_TODOS)
  const error = useThreadSelector(threadId, (state) => state?.error ?? null)
  const currentModel = useThreadSelector(threadId, (state) => state?.currentModel ?? null)

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
    if (!threadActions || !Array.isArray(streamTodos)) {
      return
    }

    threadActions.setTodos(
      streamTodos.map((todo) => ({
        id: todo.id || crypto.randomUUID(),
        content: todo.content || "",
        status: (todo.status || "pending") as "pending" | "in_progress" | "completed" | "cancelled"
      }))
    )
  }, [streamTodos, threadActions])

  useEffect(() => {
    if (!threadActions) {
      prevLoadingRef.current = false
      return
    }

    if (!prevLoadingRef.current || isLoading) {
      prevLoadingRef.current = isLoading
      return
    }

    const streamingMessages = (streamData.messages as StreamMessage[])
      .filter((message): message is StreamMessage & { id: string } => Boolean(message.id))
      .map((message) => toThreadMessage(message))

    for (const message of streamingMessages) {
      threadActions.appendMessage(message)
    }

    onMessagesPersistedRef.current?.()
    prevLoadingRef.current = false
  }, [isLoading, streamData.messages, threadActions])

  useEffect(() => {
    if (isLoading) {
      prevLoadingRef.current = true
    }
  }, [isLoading])

  const displayMessages = useMemo(() => {
    if (!threadActions) {
      return []
    }

    if (!isLoading) {
      return threadMessages
    }

    const streamingMessages: Message[] = (streamData.messages as StreamMessage[])
      .filter((message): message is StreamMessage & { id: string } => Boolean(message.id))
      .map((message) => toThreadMessage(message))
    const threadMessageIds = new Set(threadMessages.map((message) => message.id))

    return [
      ...threadMessages,
      ...streamingMessages.filter((message) => !threadMessageIds.has(message.id))
    ]
  }, [isLoading, streamData.messages, threadActions, threadMessages])

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
    async (decision: HITLDecision): Promise<void> => {
      if (!threadId || !pendingApproval || !stream || !threadActions || !currentModel) {
        return
      }

      threadActions.setPendingApproval(null)

      try {
        await stream.submit(null, {
          command: {
            resume: {
              ...decision,
              request_id: pendingApproval.id,
              tool_call_id: pendingApproval.tool_call.id
            }
          },
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
    [currentModel, pendingApproval, stream, threadActions, threadId]
  )

  return {
    clearError: threadActions?.clearError ?? (() => {}),
    displayMessages,
    error,
    isLoading,
    pendingApproval,
    resumePendingApproval,
    stream,
    todos,
    toolResults
  }
}
