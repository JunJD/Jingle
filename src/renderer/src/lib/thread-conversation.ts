import { useCallback, useMemo } from "react"
import type { HITLDecision, HITLRequest, ThreadForkState, Todo } from "@/types"
import {
  hasMessageContent,
  toComposerMessageInput,
  type ComposerMessageInput
} from "@shared/message-content"
import { createDefaultMessagesProjection, type MessagesProjection } from "./message-projection"
import { useThreadActions, useThreadSelector, useThreadStream } from "./thread-context"

const EMPTY_TODOS: Todo[] = []
const DEFAULT_FORK_STATE: ThreadForkState = {
  canFork: true
}
const DEFAULT_MESSAGE_PROJECTION = createDefaultMessagesProjection()

export interface ThreadConversationProjection {
  clearError: () => void
  error: string | null
  forkState: ThreadForkState
  isLoading: boolean
  lastUserMessageInput: ComposerMessageInput | null
  messageProjection: MessagesProjection
  pendingApproval: HITLRequest | null
  resumePendingApproval: (decision: HITLDecision) => Promise<void>
  todos: Todo[]
}

function getLastUserMessageInput(projection: MessagesProjection): ComposerMessageInput | null {
  for (let index = projection.turns.length - 1; index >= 0; index -= 1) {
    const message = projection.turns[index]?.user
    if (!message || !hasMessageContent(message.content)) {
      continue
    }

    return toComposerMessageInput(message.content, message.metadata)
  }

  return null
}

export function useThreadConversationProjection(
  threadId: string | null
): ThreadConversationProjection {
  const threadActions = useThreadActions(threadId)
  const pendingApproval = useThreadSelector(threadId, (state) => state?.pendingApproval ?? null)
  const forkState = useThreadSelector(threadId, (state) => state?.forkState ?? DEFAULT_FORK_STATE)
  const messageProjection = useThreadSelector(
    threadId,
    (state) => state?.messageProjection ?? DEFAULT_MESSAGE_PROJECTION
  )
  const todos = useThreadSelector(threadId, (state) => state?.todos ?? EMPTY_TODOS)
  const error = useThreadSelector(threadId, (state) => state?.error ?? null)
  const currentModel = useThreadSelector(threadId, (state) => state?.currentModel ?? null)
  const streamData = useThreadStream(threadId)
  const isLoading = Boolean(threadId) && streamData.isLoading
  const lastUserMessageInput = useMemo(
    () => getLastUserMessageInput(messageProjection),
    [messageProjection]
  )

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
    error,
    forkState,
    isLoading,
    lastUserMessageInput,
    messageProjection,
    pendingApproval,
    resumePendingApproval,
    todos
  }
}
