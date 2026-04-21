import { useCallback, useMemo, useState } from "react"
import type { HITLDecision, Message } from "@/types"
import {
  hasComposerMessageInputContent,
  hasMessageContent,
  toComposerMessageMetadata,
  toComposerMessageInput,
  toAgentMessageContent,
  toMessageContent,
  type ComposerMessageInput
} from "../../../shared/message-content"
import {
  useThreadActions,
  useThreadContext,
  useThreadSelector,
  type ThreadActions,
  type ThreadRecord,
  type ThreadContextValue
} from "./thread-context"
import { useThreadConversationProjection } from "./thread-conversation"

export interface EnsureAiThreadInput {
  draftInput: string
  message: string
}

export interface EnsureAiThreadResult {
  threadId: string
}

interface InvokeThreadMessageArgs {
  input: ComposerMessageInput
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
  const { input, onAfterAppendMessage, threadContext, threadId, validateInvocation } = args
  const message = input.text.trim()
  const displayContent = toMessageContent(input)
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
  const userMessageId = crypto.randomUUID()
  const userMessageMetadata = toComposerMessageMetadata({ refs: input.refs })

  actions.setDraftInput("")
  actions.appendMessage({
    id: userMessageId,
    role: "user",
    content: displayContent,
    ...(userMessageMetadata ? { metadata: userMessageMetadata } : {}),
    created_at: new Date()
  } satisfies Message)

  await onAfterAppendMessage?.({
    actions,
    isFirstMessage,
    message,
    threadId,
    threadState: { ...threadState, ...actions }
  })

  await stream.submit(
    {
      messages: [
        {
          id: userMessageId,
          type: "human",
          content: submitContent,
          ...(input.refs.length > 0 ? { additional_kwargs: { refs: input.refs } } : {})
        }
      ]
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
  invoke: (input?: ComposerMessageInput) => Promise<boolean>
  isBusy: boolean
  isPreparing: boolean
  resume: (decision: HITLDecision) => Promise<void>
  retry: () => Promise<void>
  setInput: (value: string) => void
  stop: () => Promise<void>
  visibleError: string | null
} {
  const { ensureThread, initialInput, onAfterAppendMessage, threadId, validateInvocation } = options
  const threadContext = useThreadContext()
  const threadActions = useThreadActions(threadId)
  const draftInputFromThread = useThreadSelector(threadId, (state) => state?.draftInput ?? null)
  const conversation = useThreadConversationProjection(threadId)
  const [pendingInput, setPendingInput] = useState(() => initialInput ?? "")
  const [localError, setLocalError] = useState<string | null>(null)
  const [isPreparing, setIsPreparing] = useState(false)

  const draftInput = draftInputFromThread ?? pendingInput
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

      if (threadActions) {
        threadActions.setDraftInput(value)
        return
      }

      setPendingInput(value)
    },
    [localError, threadActions]
  )

  const invoke = useCallback(
    async (nextInput?: ComposerMessageInput): Promise<boolean> => {
      const input = nextInput ?? {
        refs: [],
        text: draftInput
      }
      const message = input.text.trim()

      if (isBusy || !hasComposerMessageInputContent(input)) {
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
            draftInput: input.text,
            message
          })
          nextThreadId = createdThread.threadId
        }

        setLocalError(null)

        return await invokeThreadMessage({
          input,
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
    [
      draftInput,
      ensureThread,
      isBusy,
      onAfterAppendMessage,
      threadContext,
      threadId,
      validateInvocation
    ]
  )

  const stop = useCallback(async (): Promise<void> => {
    await conversation.stream?.stop()
    if (threadId) {
      await window.api.agent.cancel(threadId)
    }
  }, [conversation.stream, threadId])

  const resume = useCallback(
    async (decision: HITLDecision): Promise<void> => {
      await conversation.resumePendingApproval(decision)
    },
    [conversation]
  )

  const lastUserMessageInput = useMemo(() => {
    for (let index = conversation.displayMessages.length - 1; index >= 0; index -= 1) {
      const message = conversation.displayMessages[index]
      if (message.role !== "user" || !hasMessageContent(message.content)) {
        continue
      }

      return toComposerMessageInput(message.content, message.metadata)
    }

    return null
  }, [conversation.displayMessages])

  const retry = useCallback(async (): Promise<void> => {
    if (!lastUserMessageInput) {
      return
    }

    await invoke(lastUserMessageInput)
  }, [invoke, lastUserMessageInput])

  return {
    canInvoke: Boolean(draftInput.trim()) && !isBusy,
    canResume: Boolean(conversation.pendingApproval) && !isPreparing,
    canRetry: Boolean(lastUserMessageInput) && !isBusy,
    canStop: Boolean(conversation.stream) && conversation.isLoading,
    clearVisibleError,
    conversation,
    input: draftInput,
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
