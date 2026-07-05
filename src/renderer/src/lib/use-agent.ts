import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { resolveJingleAgentFollowUpDrainPlan } from "@jingle/agent-client"
import { resolveJingleAgentViewState } from "@jingle/agent-react"
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

  const runtimeStatus = useThreadSelector(threadId, (state) => state?.agent.status ?? null)
  const followUpQueue = useThreadSelector(threadId, (state) => state?.agent.followUpQueue ?? null)
  const threadError = useThreadSelector(threadId, (state) => state?.agent.error ?? null)
  const drainingFollowUpRequestIdRef = useRef<string | null>(null)
  const [dismissedThreadError, setDismissedThreadError] = useState<DismissedThreadError | null>(
    null
  )
  const [localError, setLocalError] = useState<string | null>(null)

  const visibleThreadError =
    dismissedThreadError?.threadId === threadId && dismissedThreadError.error === threadError
      ? null
      : threadError

  useEffect(() => {
    if (runtimeStatus !== "idle") {
      drainingFollowUpRequestIdRef.current = null
    }
  }, [runtimeStatus])

  const clearError = useCallback((): void => {
    setDismissedThreadError({ error: threadError, threadId })
    setLocalError(null)
  }, [threadError, threadId])

  const invoke = useCallback(
    async (messageInput, invokeOptions): Promise<boolean> => {
      const targetThreadId = invokeOptions?.threadId ?? threadId
      return invokeAgentThread({
        messageInput,
        followUpAction: invokeOptions?.followUpAction,
        onQueueFollowUp: async (queuedInput) => {
          if (!targetThreadId) {
            throw new Error("Agent thread is not selected")
          }
          await threadContext.getThreadControl(targetThreadId).agent.enqueueFollowUp(queuedInput)
        },
        onLocalError: setLocalError,
        temporaryMode,
        threadContext,
        threadId: targetThreadId,
        validateRun
      })
    },
    [temporaryMode, threadContext, threadId, validateRun]
  )

  useEffect(() => {
    const drainPlan = resolveJingleAgentFollowUpDrainPlan({
      activeRequestId: drainingFollowUpRequestIdRef.current,
      nextRequestId: followUpQueue?.nextRequestId,
      runtimeStatus,
      threadId
    })
    if (drainPlan.type !== "drain") {
      return
    }

    drainingFollowUpRequestIdRef.current = drainPlan.requestId
    const control = threadContext.getThreadControl(drainPlan.threadId)
    void (async () => {
      const item = await control.agent.takeFollowUp(drainPlan.requestId)
      if (!item) {
        drainingFollowUpRequestIdRef.current = null
        return
      }

      const didInvoke = await invokeAgentThread({
        messageInput: item.messageInput,
        onQueueFollowUp: async (queuedInput) => {
          await control.agent.enqueueFollowUp(queuedInput)
        },
        onLocalError: setLocalError,
        temporaryMode,
        threadContext,
        threadId: drainPlan.threadId,
        validateRun
      })
      if (!didInvoke) {
        await control.agent.restoreFollowUp(item)
        drainingFollowUpRequestIdRef.current = null
      }
    })()
  }, [
    followUpQueue?.nextRequestId,
    runtimeStatus,
    temporaryMode,
    threadContext,
    threadId,
    validateRun
  ])

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
    () =>
      resolveJingleAgentViewState({
        localError,
        runtimeStatus,
        threadError: visibleThreadError,
        threadId
      }),
    [localError, runtimeStatus, threadId, visibleThreadError]
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
