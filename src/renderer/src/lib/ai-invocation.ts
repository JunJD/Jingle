import { useCallback, useMemo, useState } from "react"
import type { HITLDecision, Message } from "@/types"
import {
  extractMessageText,
  hasMessageContent,
  toAgentMessageContent
} from "../../../shared/message-content"
import {
  useThreadContext,
  useThreadState,
  type ThreadActions,
  type ThreadContextValue,
  type ThreadState
} from "./thread-context"
import { useThreadConversationProjection } from "./thread-conversation"

type ThreadRecord = ThreadState & ThreadActions

export interface EnsureAiThreadInput {
  draftInput: string
  message: string
}

export interface EnsureAiThreadResult {
  threadId: string
}

interface InvokeThreadMessageArgs {
  content?: Message["content"]
  message: string
  threadContext: ThreadContextValue
  threadId: string
  onAfterAppendMessage?: (input: {
    actions: ThreadActions
    isFirstMessage: boolean
    message: string
    threadId: string
    threadState: ThreadRecord
  }) => Promise<void> | void
  validateInvocation?: (input: {
    actions: ThreadActions
    message: string
    threadId: string
    threadState: ThreadRecord
  }) => string | null
}

interface UseAiInvocationOptions {
  ensureThread?: (input: EnsureAiThreadInput) => Promise<EnsureAiThreadResult>
  initialInput?: string
  onAfterAppendMessage?: InvokeThreadMessageArgs["onAfterAppendMessage"]
  threadId: string | null
  validateInvocation?: InvokeThreadMessageArgs["validateInvocation"]
}

export async function waitForThreadStream(
  threadContext: ThreadContextValue,
  threadId: string
): Promise<NonNullable<ReturnType<ThreadContextValue["getStreamData"]>["stream"]>> {
  let stream = threadContext.getStreamData(threadId).stream

  while (!stream) {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
    stream = threadContext.getStreamData(threadId).stream
  }

  return stream
}

export async function invokeThreadMessage(args: InvokeThreadMessageArgs): Promise<boolean> {
  const {
    content,
    message: rawMessage,
    onAfterAppendMessage,
    threadContext,
    threadId,
    validateInvocation
  } = args
  const message = rawMessage.trim()
  const displayContent = content ?? message
  const submitContent = toAgentMessageContent(displayContent)
  if (!hasMessageContent(displayContent) || !hasMessageContent(submitContent)) {
    return false
  }

  const threadState = threadContext.getThreadState(threadId)
  const actions = threadContext.getThreadActions(threadId)
  const validationError = validateInvocation?.({
    actions,
    message,
    threadId,
    threadState: { ...threadState, ...actions }
  })

  if (validationError) {
    actions.setError(validationError)
    return false
  }

  const stream = await waitForThreadStream(threadContext, threadId)

  if (threadState.error) {
    actions.clearError()
  }

  if (threadState.pendingApproval) {
    actions.setPendingApproval(null)
  }

  const isFirstMessage = threadState.messages.length === 0
  const messageId = crypto.randomUUID()
  const userMessage: Message = {
    id: messageId,
    role: "user",
    content: displayContent,
    created_at: new Date()
  }

  actions.setDraftInput("")
  actions.appendMessage(userMessage)

  await onAfterAppendMessage?.({
    actions,
    isFirstMessage,
    message,
    threadId,
    threadState: { ...threadState, ...actions }
  })

  await stream.submit(
    {
      messages: [{ id: messageId, type: "human", content: submitContent }]
    },
    {
      config: {
        configurable: {
          model_id: threadState.currentModel,
          thread_id: threadId
        }
      }
    }
  )

  return true
}

export function useAiInvocation(options: UseAiInvocationOptions): {
  canInvoke: boolean
  canResume: boolean
  canRetry: boolean
  canStop: boolean
  clearVisibleError: () => void
  conversation: ReturnType<typeof useThreadConversationProjection>
  input: string
  invoke: (message?: string, content?: Message["content"]) => Promise<boolean>
  isBusy: boolean
  isPreparing: boolean
  resume: (decision: HITLDecision["type"]) => Promise<void>
  retry: () => Promise<void>
  setInput: (value: string) => void
  stop: () => Promise<void>
  visibleError: string | null
} {
  const { ensureThread, initialInput, onAfterAppendMessage, threadId, validateInvocation } = options
  const threadContext = useThreadContext()
  const threadState = useThreadState(threadId)
  const conversation = useThreadConversationProjection(threadId)
  const [pendingInput, setPendingInput] = useState(() => initialInput ?? "")
  const [localError, setLocalError] = useState<string | null>(null)
  const [isPreparing, setIsPreparing] = useState(false)

  const input = threadState?.draftInput ?? pendingInput
  const visibleError = conversation.error ?? localError
  const isBusy = conversation.isLoading || isPreparing

  const clearVisibleError = useCallback((): void => {
    setLocalError(null)
    conversation.clearError()
  }, [conversation])

  const setInput = useCallback(
    (value: string): void => {
      if (localError) {
        setLocalError(null)
      }

      if (threadState) {
        threadState.setDraftInput(value)
        return
      }

      setPendingInput(value)
    },
    [localError, threadState]
  )

  const invoke = useCallback(
    async (nextMessage?: string, content?: Message["content"]): Promise<boolean> => {
      const draftInput = nextMessage ?? input
      const message = draftInput.trim()
      const nextContent = content ?? draftInput
      if (isBusy || !hasMessageContent(nextContent)) {
        return false
      }

      setIsPreparing(true)

      try {
        let nextThreadId = threadId
        if (!nextThreadId) {
          if (!ensureThread) {
            throw new Error("useAiInvocation requires ensureThread when threadId is null")
          }

          const createdThread = await ensureThread({
            draftInput,
            message
          })
          nextThreadId = createdThread.threadId
        }

        setLocalError(null)

        return await invokeThreadMessage({
          content: nextContent,
          message,
          onAfterAppendMessage,
          threadContext,
          threadId: nextThreadId,
          validateInvocation
        })
      } catch (error) {
        setLocalError(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        setIsPreparing(false)
      }
    },
    [ensureThread, input, isBusy, onAfterAppendMessage, threadContext, threadId, validateInvocation]
  )

  const stop = useCallback(async (): Promise<void> => {
    await conversation.stream?.stop()
  }, [conversation.stream])

  const resume = useCallback(
    async (decision: HITLDecision["type"]): Promise<void> => {
      await conversation.resumePendingApproval(decision)
    },
    [conversation]
  )

  const lastUserMessage = useMemo(() => {
    for (let index = conversation.displayMessages.length - 1; index >= 0; index -= 1) {
      const message = conversation.displayMessages[index]
      if (message.role !== "user" || !hasMessageContent(message.content)) {
        continue
      }

      return {
        content: message.content,
        draftInput: extractMessageText(message.content).trim()
      }
    }

    return null
  }, [conversation.displayMessages])

  const retry = useCallback(async (): Promise<void> => {
    if (!lastUserMessage) {
      return
    }

    await invoke(lastUserMessage.draftInput, lastUserMessage.content)
  }, [invoke, lastUserMessage])

  return {
    canInvoke: Boolean(input.trim()) && !isBusy,
    canResume: Boolean(conversation.pendingApproval) && !isPreparing,
    canRetry: Boolean(lastUserMessage) && !isBusy,
    canStop: Boolean(conversation.stream) && conversation.isLoading,
    clearVisibleError,
    conversation,
    input,
    invoke,
    isBusy,
    isPreparing,
    resume,
    retry,
    setInput,
    stop,
    visibleError
  }
}
