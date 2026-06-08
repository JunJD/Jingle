import { useCallback, useEffect, useMemo, useState } from "react"
import { useThreadContext, useThreadSelector } from "./thread-context"
import {
  invokeAgentThread,
  resumeAgentThread,
  stopAgentThread,
  type AgentControl,
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
  error: string | null
  threadId: string | null
}

function formatAgentErrorForView(errorMessage: string | null): string | null {
  if (!errorMessage) {
    return null
  }

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

  const activeRunStatus = useThreadSelector(
    threadId,
    (state) => state?.agent.activeRun?.status ?? null
  )
  const threadError = useThreadSelector(threadId, (state) => state?.agent.error ?? null)
  const [dismissedThreadError, setDismissedThreadError] =
    useState<DismissedThreadError | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const isBusy = activeRunStatus === "running"
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
      invoke,
      resume,
      stop
    }),
    [clearError, invoke, resume, stop]
  )

  return {
    control,
    view
  }
}
