import { useCallback, useEffect, useMemo, useState } from "react"
import type { HITLRequest } from "@/types"
import { useThreadContext, useThreadSelector } from "./thread-context"
import {
  clearAgentThreadError,
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
  isLoading: boolean
  isPreparing: boolean
}

export interface AgentState {
  pendingApproval: HITLRequest | null
}

export type { AgentControl } from "./agent-control"

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

  if (errorMessage.includes("401") || errorMessage.includes("invalid_api_key") || errorMessage.includes("authentication")) {
    return "Authentication failed. Please check your API key in settings."
  }

  return errorMessage
}

export function useAgent(options: UseAgentOptions): {
  control: AgentControl
  state: AgentState
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
  const pendingApproval = useThreadSelector(
    threadId,
    (state) => state?.agent.pendingApproval ?? null
  )
  const threadError = useThreadSelector(threadId, (state) => state?.agent.error ?? null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [isPreparing, setIsPreparing] = useState(false)

  const isLoading = activeRunStatus === "running"
  const isBusy = isLoading || isPreparing
  const error = formatAgentErrorForView(threadError) ?? localError

  const clearError = useCallback((): void => {
    clearAgentThreadError({
      onLocalError: setLocalError,
      threadContext,
      threadId
    })
  }, [threadContext, threadId])

  const invoke = useCallback(
    async (messageInput, invokeOptions): Promise<boolean> => {
      return invokeAgentThread({
        getIsPreparing: () => isPreparing,
        messageInput,
        onLocalError: setLocalError,
        onPreparingChange: setIsPreparing,
        temporaryMode,
        threadContext,
        threadId: invokeOptions?.threadId ?? threadId,
        validateRun
      })
    },
    [isPreparing, temporaryMode, threadContext, threadId, validateRun]
  )

  const stop = useCallback(async (): Promise<void> => {
    await stopAgentThread(threadId)
  }, [threadId])

  const resume = useCallback(
    async (decision): Promise<void> => {
      await resumeAgentThread({
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
      canStop: Boolean(threadId) && isLoading,
      error,
      isBusy,
      isLoading,
      isPreparing
    }),
    [error, isBusy, isLoading, isPreparing, threadId]
  )

  const state = useMemo<AgentState>(
    () => ({
      pendingApproval
    }),
    [pendingApproval]
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
    state,
    view
  }
}
