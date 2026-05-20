import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AI_THREAD_SOURCE, AI_THREAD_VISIBILITY } from "@shared/launcher-ai"
import { DEFAULT_PERMISSION_MODE, type PermissionModeName } from "@shared/permission-mode"
import { useAiInvocation } from "@/lib/ai-invocation"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useI18n } from "@/lib/i18n"
import { maybeGenerateThreadTitle } from "@/lib/thread-title"
import { useThreadActions, useThreadSelector } from "@/lib/thread-context"
import { hasComposerMessageInputContent, type ComposerMessageRef } from "@shared/message-content"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"
import type { HITLDecision } from "@/types"
import { useAiCoreHost } from "./AiCoreHost"
import { useLauncherAiThreadNavigation } from "./useLauncherAiThreadNavigation"

interface UseAiThreadOptions {
  messageRefs?: ComposerMessageRef[]
  onDidInvoke?: () => void
}

export function useAiThread(options: UseAiThreadOptions = {}): {
  conversation: ReturnType<typeof useAiInvocation>["conversation"] & {
    clearVisibleError: () => void
    visibleError: string | null
  }
  branchThread: () => Promise<string | null>
  canGoToNextChat: boolean
  canGoToPreviousChat: boolean
  canStop: boolean
  currentModelId: string | null
  currentPermissionMode: PermissionModeName
  goToNextChat: () => Promise<string | null>
  goToPreviousChat: () => Promise<string | null>
  handleApprovalDecision: (decision: HITLDecision) => Promise<void>
  inputStatus: LauncherInputStatus
  isBusy: boolean
  primaryActionDisabled: boolean
  query: string
  retry: () => Promise<void>
  runPrimaryAction: () => void
  selectModel: (modelId: string) => void
  selectPermissionMode: (permissionMode: PermissionModeName) => void
  setQuery: (value: string) => void
  startNewThread: () => Promise<string | null>
  stop: () => Promise<void>
  threadId: string | null
} {
  const { messageRefs = [], onDidInvoke } = options
  const { copy } = useI18n()
  const host = useAiCoreHost()
  const hasRunInitialActionRef = useRef(false)
  const [inputStatus, setInputStatus] = useState<LauncherInputStatus>("idle")
  const [pendingModelId, setPendingModelId] = useState<string | null>(null)
  const [pendingPermissionMode, setPendingPermissionMode] =
    useState<PermissionModeName>(DEFAULT_PERMISSION_MODE)
  const [threadActionError, setThreadActionError] = useState<string | null>(null)
  const threads = useHistoryShellStore((state) => state.threads)
  const updateThread = useHistoryShellStore((state) => state.updateThread)
  const threadNavigation = useLauncherAiThreadNavigation({
    initialAction: host.initialAction,
    seedQuery: host.seedQuery
  })
  const threadId = threadNavigation.threadId
  const threadActions = useThreadActions(threadId)
  const currentModelId =
    useThreadSelector(threadId, (state) => state?.currentModel ?? null) ?? pendingModelId
  const currentPermissionMode =
    useThreadSelector(threadId, (state) => state?.permissionMode ?? null) ?? pendingPermissionMode
  const invocation = useAiInvocation({
    ensureThread: async ({ draftInput }) => {
      const createdThread = await threadNavigation.createThread({
        draftInput,
        modelId: pendingModelId ?? undefined,
        permissionMode: currentPermissionMode,
        source: AI_THREAD_SOURCE,
        title: copy.launcher.aiThreadTitle,
        visibility: AI_THREAD_VISIBILITY
      })
      return {
        threadId: createdThread.threadId
      }
    },
    initialInput: host.seedQuery,
    onAfterAppendMessage: ({ isFirstMessage, message, threadId }) => {
      if (!isFirstMessage) {
        return
      }

      const currentThread = threads.find((thread) => thread.thread_id === threadId)
      void maybeGenerateThreadTitle(threadId, message, {
        persistTitle: async (nextThreadId, title) => {
          await updateThread(nextThreadId, { title })
        },
        thread: currentThread
      })
    },
    threadId
  })
  const query = invocation.input
  const isBusy = invocation.isBusy
  const hasPendingApproval = Boolean(invocation.conversation.pendingApproval)
  const messageInput = useMemo(
    () => ({
      refs: messageRefs,
      text: query
    }),
    [messageRefs, query]
  )
  const initialMessageInput = useMemo(
    () => ({
      refs: messageRefs,
      text: host.seedQuery
    }),
    [host.seedQuery, messageRefs]
  )

  const runPrimaryAction = useCallback((): void => {
    if (isBusy || hasPendingApproval || !hasComposerMessageInputContent(messageInput)) {
      return
    }

    setInputStatus("pending")
    void invocation.invoke(messageInput).then((didInvoke) => {
      if (didInvoke) {
        onDidInvoke?.()
      }
    })
  }, [hasPendingApproval, invocation, isBusy, messageInput, onDidInvoke])

  useEffect(() => {
    if (hasRunInitialActionRef.current || host.initialAction !== "submit") {
      return
    }

    if (!hasComposerMessageInputContent(initialMessageInput)) {
      hasRunInitialActionRef.current = true
      return
    }

    const submitFrameId = window.requestAnimationFrame(() => {
      hasRunInitialActionRef.current = true
      setInputStatus("pending")
      void invocation.invoke(initialMessageInput).then((didInvoke) => {
        if (didInvoke) {
          onDidInvoke?.()
        }
      })
    })

    return () => {
      window.cancelAnimationFrame(submitFrameId)
    }
  }, [host.initialAction, initialMessageInput, invocation, onDidInvoke])

  const handleApprovalDecision = useCallback(
    async (decision: HITLDecision): Promise<void> => {
      setInputStatus("pending")
      await invocation.resume(decision)
    },
    [invocation]
  )
  const clearVisibleError = useCallback((): void => {
    setThreadActionError(null)
    invocation.clearVisibleError()
  }, [invocation])
  const startNewThread = useCallback(async (): Promise<string | null> => {
    try {
      setThreadActionError(null)
      const createdThread = await threadNavigation.createThread({
        modelId: currentModelId ?? undefined,
        permissionMode: currentPermissionMode,
        source: AI_THREAD_SOURCE,
        title: copy.launcher.aiThreadTitle,
        visibility: AI_THREAD_VISIBILITY
      })
      return createdThread.threadId
    } catch (error) {
      setThreadActionError(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [copy.launcher.aiThreadTitle, currentModelId, currentPermissionMode, threadNavigation])
  const branchThread = useCallback(async (): Promise<string | null> => {
    if (!threadId) {
      return null
    }

    try {
      setThreadActionError(null)
      const branchedThread = await threadNavigation.branchThread(threadId)
      return branchedThread.threadId
    } catch (error) {
      setThreadActionError(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [threadId, threadNavigation])
  const goToPreviousChat = useCallback(async (): Promise<string | null> => {
    try {
      setThreadActionError(null)
      return await threadNavigation.goToPreviousThread()
    } catch (error) {
      setThreadActionError(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [threadNavigation])
  const goToNextChat = useCallback(async (): Promise<string | null> => {
    try {
      setThreadActionError(null)
      return await threadNavigation.goToNextThread()
    } catch (error) {
      setThreadActionError(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [threadNavigation])
  const selectModel = useCallback(
    (modelId: string): void => {
      if (threadActions) {
        threadActions.setCurrentModel(modelId)
        return
      }

      setPendingModelId(modelId)
    },
    [threadActions]
  )
  const selectPermissionMode = useCallback(
    (permissionMode: PermissionModeName): void => {
      if (threadActions) {
        threadActions.setPermissionMode(permissionMode)
        return
      }

      setPendingPermissionMode(permissionMode)
    },
    [threadActions]
  )

  const primaryActionDisabled =
    isBusy || hasPendingApproval || !hasComposerMessageInputContent(messageInput)

  useEffect(() => {
    if (isBusy) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setInputStatus("idle")
    }, 180)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isBusy])

  return {
    conversation: {
      ...invocation.conversation,
      clearVisibleError,
      visibleError: invocation.visibleError ?? threadActionError
    },
    branchThread,
    canStop: invocation.canStop,
    canGoToNextChat: threadNavigation.canGoToNextThread,
    canGoToPreviousChat: threadNavigation.canGoToPreviousThread,
    currentModelId,
    currentPermissionMode,
    goToNextChat,
    goToPreviousChat,
    handleApprovalDecision,
    inputStatus,
    isBusy,
    primaryActionDisabled,
    query,
    retry: invocation.retry,
    runPrimaryAction,
    selectModel,
    selectPermissionMode,
    setQuery: invocation.setInput,
    startNewThread,
    stop: invocation.stop,
    threadId
  }
}
