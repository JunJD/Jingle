import { useCallback, useEffect, useMemo, useState } from "react"
import type { IpcErrorPayload } from "@shared/ipc-error"
import { useThreadContext, useThreadSelector } from "./thread-context"
import {
  editLastUserMessageAndInvokeAgentThread,
  invokeAgentThread,
  resumeAgentThread,
  stopAgentThread,
  type AgentControl,
  type EditLastUserMessageAndInvokeInput,
  type AgentRunValidator
} from "./agent-control"

export interface UseAgentOptions {
  temporaryMode?: boolean
  threadId: string | null
  validateRun?: AgentRunValidator
}

export interface AgentView {
  canStop: boolean
  error: string | null
  isBusy: boolean
}

export type { AgentControl } from "./agent-control"

interface DismissedThreadError {
  error: IpcErrorPayload | null
  threadId: string | null
}

function formatAgentErrorForView(errorPayload: IpcErrorPayload | null): string | null {
  if (!errorPayload) {
    return null
  }

  const errorMessage = errorPayload.message
  const contextWindowMatch = errorMessage.match(/prompt is too long: (\d+) tokens > (\d+) maximum/i)
  if (contextWindowMatch) {
    const [, usedTokens, maxTokens] = contextWindowMatch
    const usedK = Math.round(parseInt(usedTokens, 10) / 1000)
    const maxK = Math.round(parseInt(maxTokens, 10) / 1000)
    return `Context window exceeded (${usedK}K / ${maxK}K tokens). The conversation history is too long. Please start a new thread to continue.`
  }

  if (errorMessage.includes("rate_limit") || errorMessage.includes("429")) {
    return "Rate limit exceeded. Please wait a moment before sending another message."
  }

  if (
    errorMessage.includes("401") ||
    errorMessage.includes("invalid_api_key") ||
    errorMessage.includes("authentication")
  ) {
    return "Authentication failed. Please check your API key in settings."
  }

  return errorMessage
}

export function useAgent(options: UseAgentOptions): {
  control: AgentControl
  view: AgentView
} {
  const { temporaryMode = false, threadId, validateRun } = options
  const threadContext = useThreadContext()
  useEffect(() => {
    if (!threadId) {
      return
    }

    threadContext.ensureThreadRuntime(threadId)
  }, [threadContext, threadId])

  const runtimeStatus = useThreadSelector(
    threadId,
    (state) => state?.agent.status ?? null
  )
  const threadError = useThreadSelector(threadId, (state) => state?.agent.error ?? null)
  const [dismissedThreadError, setDismissedThreadError] =
    useState<DismissedThreadError | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const isBusy = runtimeStatus === "running"
  const visibleThreadError =
    dismissedThreadError?.threadId === threadId && dismissedThreadError.error === threadError
      ? null
      : threadError
  const error = formatAgentErrorForView(visibleThreadError) ?? localError

  const clearError = useCallback((): void => {
    setDismissedThreadError({ error: threadError, threadId })
    setLocalError(null)
  }, [threadError, threadId])

  const invoke = useCallback(
    async (messageInput, invokeOptions): Promise<boolean> => {
      return invokeAgentThread({
        messageInput,
        onLocalError: setLocalError,
        temporaryMode,
        threadContext,
        threadId: invokeOptions?.threadId ?? threadId,
        validateRun
      })
    },
    [temporaryMode, threadContext, threadId, validateRun]
  )

  const editLastUserMessageAndInvoke = useCallback(
    async (
      { messageId, messageInput }: EditLastUserMessageAndInvokeInput,
      invokeOptions?: { threadId?: string }
    ): Promise<boolean> => {
      return editLastUserMessageAndInvokeAgentThread({
        messageId,
        messageInput,
        onLocalError: setLocalError,
        temporaryMode,
        threadContext,
        threadId: invokeOptions?.threadId ?? threadId,
        validateRun
      })
    },
    [temporaryMode, threadContext, threadId, validateRun]
  )

  const stop = useCallback(async (): Promise<void> => {
    await stopAgentThread(threadId)
  }, [threadId])

  const resume = useCallback(
    async (decision): Promise<boolean> => {
      return resumeAgentThread({
        decision,
        onLocalError: setLocalError,
        threadContext,
        threadId
      })
    },
    [threadContext, threadId]
  )

  const view = useMemo<AgentView>(
    () => ({
      canStop: Boolean(threadId) && isBusy,
      error,
      isBusy
    }),
    [error, isBusy, threadId]
  )

  const control = useMemo<AgentControl>(
    () => ({
      clearError,
      editLastUserMessageAndInvoke,
      invoke,
      resume,
      stop
    }),
    [clearError, editLastUserMessageAndInvoke, invoke, resume, stop]
  )

  return {
    control,
    view
  }
}
