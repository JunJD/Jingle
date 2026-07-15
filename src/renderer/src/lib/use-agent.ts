import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  createJingleAgentFollowUpDrainRegistry,
  resolveJingleAgentFollowUpDrainPlan
} from "@jingle/agent-client"
import { resolveJingleAgentViewState } from "@jingle/agent-react"
import type { IpcErrorPayload } from "@shared/ipc-error"
import { useThreadContext, useThreadSelector } from "./thread-context"
import {
  editLastUserMessageAndInvokeAgentThread,
  invokeAgentThread,
  resumeAgentThread,
  stopAgentThread,
  type AgentCommandActivity,
  type AgentControl,
  type EditLastUserMessageAndInvokeInput,
  type AgentRunValidator
} from "./agent-control"

export interface UseAgentOptions {
  onCommandAdmitted?: (activity: AgentCommandActivity) => void
  onCommandSettled?: (activity: AgentCommandActivity) => void
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
  const {
    onCommandAdmitted,
    onCommandSettled,
    temporaryMode = false,
    threadId,
    validateRun
  } = options
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
  const followUpDrainRegistryRef = useRef(createJingleAgentFollowUpDrainRegistry())
  const [dismissedThreadError, setDismissedThreadError] = useState<DismissedThreadError | null>(
    null
  )
  const [localError, setLocalError] = useState<string | null>(null)

  const visibleThreadError =
    dismissedThreadError?.threadId === threadId && dismissedThreadError.error === threadError
      ? null
      : threadError

  useEffect(() => {
    if (threadId && runtimeStatus !== "idle") {
      followUpDrainRegistryRef.current.clear(threadId)
    }
  }, [runtimeStatus, threadId])

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
        onCommandAdmitted,
        onCommandSettled,
        temporaryMode,
        threadContext,
        threadId: targetThreadId,
        validateRun
      })
    },
    [onCommandAdmitted, onCommandSettled, temporaryMode, threadContext, threadId, validateRun]
  )

  useEffect(() => {
    const drainPlan = resolveJingleAgentFollowUpDrainPlan({
      activeRequestId: threadId
        ? followUpDrainRegistryRef.current.getActiveRequestId(threadId)
        : null,
      nextRequestId: followUpQueue?.nextRequestId,
      runtimeStatus,
      threadId
    })
    if (drainPlan.type !== "drain") {
      return
    }

    const lease = followUpDrainRegistryRef.current.acquire(drainPlan.threadId, drainPlan.requestId)
    if (lease === null) {
      return
    }
    const control = threadContext.getThreadControl(drainPlan.threadId)
    void (async () => {
      try {
        const item = await control.agent.takeFollowUp(drainPlan.requestId)
        if (!item) {
          return
        }

        const didInvoke = await invokeAgentThread({
          messageInput: item.messageInput,
          onQueueFollowUp: async (queuedInput) => {
            await control.agent.enqueueFollowUp(queuedInput)
          },
          onLocalError: setLocalError,
          onCommandAdmitted,
          onCommandSettled,
          temporaryMode,
          threadContext,
          threadId: drainPlan.threadId,
          validateRun
        })
        if (!didInvoke) {
          await control.agent.restoreFollowUp(item)
        }
      } catch (error) {
        setLocalError(error instanceof Error ? error.message : String(error))
      } finally {
        lease.release()
      }
    })()
  }, [
    followUpQueue?.nextRequestId,
    runtimeStatus,
    onCommandAdmitted,
    onCommandSettled,
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
        onCommandAdmitted,
        onCommandSettled,
        temporaryMode,
        threadContext,
        threadId: invokeOptions?.threadId ?? threadId,
        validateRun
      })
    },
    [onCommandAdmitted, onCommandSettled, temporaryMode, threadContext, threadId, validateRun]
  )

  const stop = useCallback(async (): Promise<void> => {
    await stopAgentThread(threadId)
  }, [threadId])

  const resume = useCallback(
    async (decision): Promise<boolean> => {
      return resumeAgentThread({
        decision,
        onCommandAdmitted,
        onCommandSettled,
        onLocalError: setLocalError,
        threadContext,
        threadId
      })
    },
    [onCommandAdmitted, onCommandSettled, threadContext, threadId]
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
