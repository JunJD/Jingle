import { useCallback, useMemo, useState } from "react"
import type { HITLDecision, Message } from "@/types"
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
    message: rawMessage,
    onAfterAppendMessage,
    threadContext,
    threadId,
    validateInvocation
  } = args
  const message = rawMessage.trim()
  if (!message) {
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
  const userMessage: Message = {
    id: crypto.randomUUID(),
    role: "user",
    content: message,
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
      messages: [{ type: "human", content: message }]
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
  invoke: (message?: string) => Promise<void>
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
    async (nextMessage?: string): Promise<void> => {
      const message = (nextMessage ?? input).trim()
      if (!message || isBusy) {
        return
      }

      setIsPreparing(true)

      try {
        let nextThreadId = threadId
        if (!nextThreadId) {
          if (!ensureThread) {
            throw new Error("useAiInvocation requires ensureThread when threadId is null")
          }

          const createdThread = await ensureThread({
            draftInput: message,
            message
          })
          nextThreadId = createdThread.threadId
        }

        setLocalError(null)

        await invokeThreadMessage({
          message,
          onAfterAppendMessage,
          threadContext,
          threadId: nextThreadId,
          validateInvocation
        })
      } catch (error) {
        setLocalError(error instanceof Error ? error.message : String(error))
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
      if (message.role !== "user" || typeof message.content !== "string") {
        continue
      }

      const content = message.content.trim()
      if (content) {
        return content
      }
    }

    return null
  }, [conversation.displayMessages])

  const retry = useCallback(async (): Promise<void> => {
    if (!lastUserMessage) {
      return
    }

    await invoke(lastUserMessage)
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
