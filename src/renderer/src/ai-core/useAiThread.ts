import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AI_THREAD_SOURCE, AI_THREAD_VISIBILITY } from "@shared/launcher-ai"
import { type PermissionModeName } from "@shared/permission-mode"
import { useAiInvocation } from "@/lib/ai-invocation"
import { useI18n } from "@/lib/i18n"
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
  branchThread: (messageId?: string) => Promise<string | null>
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
  setComposerRefs: (refs: ComposerMessageRef[]) => void
  setQuery: (value: string) => void
  startFreshDraft: () => Promise<boolean>
  stop: () => Promise<void>
  threadId: string | null
} {
  const { messageRefs = [], onDidInvoke } = options
  const { copy } = useI18n()
  const host = useAiCoreHost()
  const hasRunInitialActionRef = useRef(false)
  const [inputStatus, setInputStatus] = useState<LauncherInputStatus>("idle")
  const [composerRefs, setComposerRefs] = useState<ComposerMessageRef[]>([])
  const [threadActionError, setThreadActionError] = useState<string | null>(null)
  const threadNavigation = useLauncherAiThreadNavigation({
    initialAction: host.initialAction,
    seedQuery: host.seedQuery
  })
  const threadId = threadNavigation.threadId
  const draftTarget = threadNavigation.target?.kind === "draft" ? threadNavigation.target : null
  const threadActions = useThreadActions(threadId)
  const currentModelId =
    useThreadSelector(threadId, (state) => state?.currentModel ?? null) ?? draftTarget?.modelId ?? null
  const currentPermissionMode =
    useThreadSelector(threadId, (state) => state?.permissionMode ?? null) ??
    draftTarget?.permissionMode ??
    threadNavigation.defaultDraftPermissionMode
  const invocation = useAiInvocation({
    ensureThread: async ({ draftInput }) => {
      const createdThread = await threadNavigation.createThread({
        draftInput,
        modelId: draftTarget?.modelId ?? undefined,
        permissionMode: draftTarget?.permissionMode ?? threadNavigation.defaultDraftPermissionMode,
        source: AI_THREAD_SOURCE,
        title: copy.launcher.aiThreadTitle,
        visibility: AI_THREAD_VISIBILITY
      })
      return {
        threadId: createdThread.threadId
      }
    },
    initialInput: host.seedQuery,
    threadId
  })
  const query = invocation.input
  const isBusy = invocation.isBusy
  const hasPendingApproval = Boolean(invocation.conversation.pendingApproval)
  const messageInput = useMemo(
    () => ({
      refs: [...composerRefs, ...messageRefs],
      text: query
    }),
    [composerRefs, messageRefs, query]
  )
  const initialMessageInput = useMemo(
    () => ({
      refs: [...composerRefs, ...messageRefs],
      text: host.seedQuery
    }),
    [composerRefs, host.seedQuery, messageRefs]
  )

  const runPrimaryAction = useCallback((): void => {
    if (isBusy || hasPendingApproval || !hasComposerMessageInputContent(messageInput)) {
      return
    }

    setInputStatus("pending")
    void invocation.invoke(messageInput).then((didInvoke) => {
      if (didInvoke) {
        setComposerRefs([])
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
          setComposerRefs([])
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
  const startFreshDraft = useCallback(async (): Promise<boolean> => {
    try {
      setThreadActionError(null)
      await threadNavigation.startFreshDraft({
        modelId: currentModelId,
        permissionMode: currentPermissionMode
      })
      invocation.resetPendingInput()
      return true
    } catch (error) {
      setThreadActionError(error instanceof Error ? error.message : String(error))
      return false
    }
  }, [currentModelId, currentPermissionMode, invocation, threadNavigation])
  const branchThread = useCallback(
    async (messageId?: string): Promise<string | null> => {
      if (!threadId) {
        return null
      }

      try {
        setThreadActionError(null)
        const branchedThread = messageId
          ? await threadNavigation.branchThreadUntilMessage(threadId, messageId)
          : await threadNavigation.branchThread(threadId)
        return branchedThread.threadId
      } catch (error) {
        setThreadActionError(error instanceof Error ? error.message : String(error))
        return null
      }
    },
    [threadId, threadNavigation]
  )
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

      threadNavigation.updateFreshDraft({ modelId })
    },
    [threadActions, threadNavigation]
  )
  const selectPermissionMode = useCallback(
    (permissionMode: PermissionModeName): void => {
      if (threadActions) {
        threadActions.setPermissionMode(permissionMode)
        return
      }

      threadNavigation.updateFreshDraft({ permissionMode })
    },
    [threadActions, threadNavigation]
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
    setComposerRefs,
    setQuery: invocation.setInput,
    startFreshDraft,
    stop: invocation.stop,
    threadId
  }
}
