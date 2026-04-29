import { useCallback, useMemo } from "react"
import type { HITLDecision, HITLRequest, Message, Todo } from "@/types"
import { useThreadActions, useThreadSelector, useThreadStream } from "./thread-context"

export interface ToolResultInfo {
  content: string | unknown
}

const EMPTY_THREAD_MESSAGES: Message[] = []
const EMPTY_TODOS: Todo[] = []

export interface ThreadConversationProjection {
  clearError: () => void
  displayMessages: Message[]
  error: string | null
  isLoading: boolean
  pendingApproval: HITLRequest | null
  resumePendingApproval: (decision: HITLDecision) => Promise<void>
  todos: Todo[]
  toolResults: Map<string, ToolResultInfo>
}

export function useThreadConversationProjection(
  threadId: string | null,
  _options?: {
    onMessagesPersisted?: () => void
  }
): ThreadConversationProjection {
  const threadActions = useThreadActions(threadId)
  const threadMessages = useThreadSelector(
    threadId,
    (state) => state?.messages ?? EMPTY_THREAD_MESSAGES
  )
  const pendingApproval = useThreadSelector(threadId, (state) => state?.pendingApproval ?? null)
  const todos = useThreadSelector(threadId, (state) => state?.todos ?? EMPTY_TODOS)
  const error = useThreadSelector(threadId, (state) => state?.error ?? null)
  const currentModel = useThreadSelector(threadId, (state) => state?.currentModel ?? null)
  const streamData = useThreadStream(threadId)
  const isLoading = Boolean(threadId) && streamData.isLoading

  const toolResults = useMemo(() => {
    const results = new Map<string, ToolResultInfo>()

    for (const message of threadMessages) {
      if (message.role === "tool" && message.tool_call_id) {
        results.set(message.tool_call_id, {
          content: message.content
        })
      }
    }

    return results
  }, [threadMessages])

  const resumePendingApproval = useCallback(
    async (decision: HITLDecision): Promise<void> => {
      if (!threadId || !pendingApproval || !currentModel) {
        return
      }

      window.api.agent.resume(
        threadId,
        {
          ...decision,
          request_id: pendingApproval.id,
          tool_call_id: pendingApproval.tool_call.id
        },
        currentModel
      )
    },
    [currentModel, pendingApproval, threadId]
  )

  return {
    clearError: threadActions?.clearError ?? (() => {}),
    displayMessages: threadMessages,
    error,
    isLoading,
    pendingApproval,
    resumePendingApproval,
    todos,
    toolResults
  }
}
