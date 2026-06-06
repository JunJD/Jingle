import { useCallback, useMemo, useState } from "react"
import type { HITLDecision, HITLRequest, ThreadForkState, Todo } from "@/types"
import {
  hasComposerMessageInputContent,
  hasMessageContent,
  hasMessageContent as hasDisplayMessageContent,
  toAgentMessageContent,
  toComposerMessageInput,
  toMessageContent,
  type ComposerMessageInput
} from "@shared/message-content"
import {
  useThreadActions,
  useThreadContext,
  useThreadSelector,
  useThreadStream,
  type ThreadActions,
  type ThreadRecord
} from "./thread-context"
import { createDefaultMessagesProjection, type MessagesProjection } from "./message-projection"

export interface EnsureAgentThreadInput {
  draftInput: string
  message: string
}

export interface EnsureAgentThreadResult {
  threadId: string
}

export interface UseAgentOptions {
  ensureThread?: (input: EnsureAgentThreadInput) => Promise<EnsureAgentThreadResult>
  initialInput?: string
  temporaryMode?: boolean
  threadId: string | null
  validateRun?: (input: {
    actions: ThreadActions
    message: string
    threadId: string
    threadState: ThreadRecord
  }) => string | null
}

export interface AgentState {
  canInvoke: boolean
  canResume: boolean
  canRetry: boolean
  canStop: boolean
  error: string | null
  forkState: ThreadForkState
  input: string
  isBusy: boolean
  isLoading: boolean
  isPreparing: boolean
  lastUserMessageInput: ComposerMessageInput | null
  messageProjection: MessagesProjection
  pendingApproval: HITLRequest | null
  todos: Todo[]
}

export interface AgentControl {
  clearError: () => void
  invoke: (input?: ComposerMessageInput, options?: { threadId?: string }) => Promise<boolean>
  resetInput: (value?: string) => void
  resume: (decision: HITLDecision) => Promise<void>
  retry: () => Promise<void>
  setInput: (value: string) => void
  stop: () => Promise<void>
}

const EMPTY_TODOS: Todo[] = []
const DEFAULT_FORK_STATE: ThreadForkState = {
  canFork: true
}
const DEFAULT_MESSAGE_PROJECTION = createDefaultMessagesProjection()

function deriveEffectiveForkState(input: {
  activeRun: { status: "running" | "waiting_approval" } | null
  baseForkState: ThreadForkState
  pendingApproval: HITLRequest | null
}): ThreadForkState {
  if (input.pendingApproval) {
    return {
      canFork: false,
      reason: "pending_hitl"
    }
  }

  if (input.activeRun) {
    return {
      canFork: false,
      reason: "busy"
    }
  }

  if (input.baseForkState.reason === "checkpoint_interrupt") {
    return input.baseForkState
  }

  return input.baseForkState.canFork ? input.baseForkState : { canFork: true }
}

function getLastUserMessageInput(projection: MessagesProjection): ComposerMessageInput | null {
  for (let index = projection.turns.length - 1; index >= 0; index -= 1) {
    const message = projection.turns[index]?.user
    if (!message || !hasDisplayMessageContent(message.content)) {
      continue
    }

    return toComposerMessageInput(message.content, message.metadata)
  }

  return null
}

export function useAgent(options: UseAgentOptions): {
  control: AgentControl
  state: AgentState
} {
  const { ensureThread, initialInput, temporaryMode = false, threadId, validateRun } = options
  const threadContext = useThreadContext()
  const threadActions = useThreadActions(threadId)
  const draftInputFromThread = useThreadSelector(threadId, (state) => state?.draftInput ?? null)
  const activeRun = useThreadSelector(threadId, (state) => state?.activeRun ?? null)
  const pendingApproval = useThreadSelector(threadId, (state) => state?.pendingApproval ?? null)
  const baseForkState = useThreadSelector(threadId, (state) => state?.forkState ?? DEFAULT_FORK_STATE)
  const messageProjection = useThreadSelector(
    threadId,
    (state) => state?.messageProjection ?? DEFAULT_MESSAGE_PROJECTION
  )
  const todos = useThreadSelector(threadId, (state) => state?.todos ?? EMPTY_TODOS)
  const threadError = useThreadSelector(threadId, (state) => state?.error ?? null)
  const currentModel = useThreadSelector(threadId, (state) => state?.currentModel ?? null)
  const streamData = useThreadStream(threadId)
  const [pendingInput, setPendingInput] = useState(() => initialInput ?? "")
  const [localError, setLocalError] = useState<string | null>(null)
  const [isPreparing, setIsPreparing] = useState(false)

  const input = draftInputFromThread ?? pendingInput
  const isLoading = Boolean(threadId) && streamData.isLoading
  const isBusy = isLoading || isPreparing
  const error = threadError ?? localError
  const forkState = useMemo(
    () =>
      deriveEffectiveForkState({
        activeRun,
        baseForkState,
        pendingApproval
      }),
    [activeRun, baseForkState, pendingApproval]
  )
  const lastUserMessageInput = useMemo(
    () => getLastUserMessageInput(messageProjection),
    [messageProjection]
  )

  const clearError = useCallback((): void => {
    setLocalError(null)
    threadActions?.clearError()
  }, [threadActions])

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

  const resetInput = useCallback((value = ""): void => {
    setLocalError(null)
    setPendingInput(value)
  }, [])

  const invoke = useCallback(
    async (
      nextInput?: ComposerMessageInput,
      invokeOptions?: { threadId?: string }
    ): Promise<boolean> => {
      const inputToSend = nextInput ?? {
        refs: [],
        text: input
      }
      const message = inputToSend.text.trim()
      const displayContent = toMessageContent(inputToSend)
      const submitContent = toAgentMessageContent(displayContent)

      if (
        isPreparing ||
        !hasComposerMessageInputContent(inputToSend) ||
        !hasMessageContent(displayContent) ||
        !hasMessageContent(submitContent)
      ) {
        return false
      }

      setIsPreparing(true)

      try {
        let targetThreadId = invokeOptions?.threadId ?? threadId
        if (!targetThreadId) {
          if (!ensureThread) {
            throw new Error("useAgent requires ensureThread when threadId is null")
          }

          const createdThread = await ensureThread({
            draftInput: inputToSend.text,
            message
          })
          targetThreadId = createdThread.threadId
        }

        await threadContext.awaitThreadRuntime(targetThreadId)

        const threadState = threadContext.getThreadState(targetThreadId)
        if (threadState.activeRun?.status === "running" || threadState.pendingApproval) {
          return false
        }

        const actions = threadContext.getThreadActions(targetThreadId)
        const validationError = validateRun?.({
          actions,
          message,
          threadId: targetThreadId,
          threadState: { ...threadState, ...actions }
        })

        if (validationError) {
          actions.setError(validationError)
          return false
        }

        setLocalError(null)
        actions.setDraftInput("")

        window.api.agent.invoke(
          targetThreadId,
          {
            content: submitContent,
            id: crypto.randomUUID(),
            ...(inputToSend.refs.length > 0
              ? { additional_kwargs: { refs: inputToSend.refs } }
              : {})
          },
          threadState.currentModel,
          threadState.permissionMode,
          temporaryMode
        )

        return true
      } catch (error) {
        setLocalError(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        setIsPreparing(false)
      }
    },
    [ensureThread, input, isPreparing, temporaryMode, threadContext, threadId, validateRun]
  )

  const stop = useCallback(async (): Promise<void> => {
    if (threadId) {
      await window.api.agent.cancel(threadId)
    }
  }, [threadId])

  const resume = useCallback(
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

  const retry = useCallback(async (): Promise<void> => {
    if (!lastUserMessageInput) {
      return
    }

    await invoke(lastUserMessageInput)
  }, [invoke, lastUserMessageInput])

  const hasPendingApproval = Boolean(pendingApproval)
  const state = useMemo<AgentState>(
    () => ({
      canInvoke: hasComposerMessageInputContent({ refs: [], text: input }) && !isBusy && !hasPendingApproval,
      canResume: hasPendingApproval && !isPreparing,
      canRetry: Boolean(lastUserMessageInput) && !isBusy && !hasPendingApproval,
      canStop: Boolean(threadId) && isLoading,
      error,
      forkState,
      input,
      isBusy,
      isLoading,
      isPreparing,
      lastUserMessageInput,
      messageProjection,
      pendingApproval,
      todos
    }),
    [
      error,
      forkState,
      hasPendingApproval,
      input,
      isBusy,
      isLoading,
      isPreparing,
      lastUserMessageInput,
      messageProjection,
      pendingApproval,
      threadId,
      todos
    ]
  )

  const control = useMemo<AgentControl>(
    () => ({
      clearError,
      invoke,
      resetInput,
      resume,
      retry,
      setInput,
      stop
    }),
    [clearError, invoke, resetInput, resume, retry, setInput, stop]
  )

  return {
    control,
    state
  }
}
