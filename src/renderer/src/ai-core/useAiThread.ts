import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AI_THREAD_SOURCE, AI_THREAD_VISIBILITY } from "@shared/launcher-ai"
import { type PermissionModeName } from "@shared/permission-mode"
import { useAgent, type AgentState } from "@/lib/use-agent"
import { useI18n } from "@/lib/i18n"
import { useThreadActions, useThreadSelector } from "@/lib/thread-context"
import {
  hasComposerMessageInputContent,
  type ComposerMessageInput,
  type ComposerMessageRef
} from "@shared/message-content"
import type { LauncherInputStatus } from "@launcher-shell/launcher-input-status"
import type { HITLDecision } from "@/types"
import { useAiCoreHost } from "./AiCoreHost"
import { useLauncherAiThreadNavigation } from "./useLauncherAiThreadNavigation"

interface UseAiThreadOptions {
  messageRefs?: ComposerMessageRef[]
  onDidInvoke?: () => void
}

export function useAiThread(options: UseAiThreadOptions = {}): {
  conversation: AgentState & {
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
  runPrimaryAction: (inputOverride?: ComposerMessageInput) => void
  selectModel: (modelId: string) => void
  selectPermissionMode: (permissionMode: PermissionModeName) => void
  setQuery: (value: string) => void
  startFreshDraft: () => Promise<boolean>
  stop: () => Promise<void>
  threadId: string | null
} {
  const { messageRefs = [], onDidInvoke } = options
  const { copy } = useI18n()
  const host = useAiCoreHost()
  const [initialSeedQuery] = useState(host.seedQuery)
  const hasRunInitialActionRef = useRef(false)
  const [inputStatus, setInputStatus] = useState<LauncherInputStatus>("idle")
  const [threadActionError, setThreadActionError] = useState<string | null>(null)
  const threadNavigation = useLauncherAiThreadNavigation({
    initialAction: host.initialAction,
    seedQuery: initialSeedQuery
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
  const agent = useAgent({
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
    initialInput: initialSeedQuery,
    threadId
  })
  const query = agent.state.input
  const isBusy = agent.state.isBusy
  const hasPendingApproval = Boolean(agent.state.pendingApproval)
  const messageInput = useMemo(
    () => ({
      refs: [...messageRefs],
      text: query
    }),
    [messageRefs, query]
  )
  const initialMessageInput = useMemo(
    () => ({
      refs: [...messageRefs],
      text: initialSeedQuery
    }),
    [initialSeedQuery, messageRefs]
  )

  const runPrimaryAction = useCallback(
    (inputOverride?: ComposerMessageInput): void => {
      const input = inputOverride ?? messageInput
      if (isBusy || hasPendingApproval || !hasComposerMessageInputContent(input)) {
        return
      }

      setInputStatus("pending")
      void agent.control.invoke(input).then((didInvoke) => {
        if (didInvoke) {
          onDidInvoke?.()
        }
      })
    },
    [agent.control, hasPendingApproval, isBusy, messageInput, onDidInvoke]
  )

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
      void agent.control.invoke(initialMessageInput).then((didInvoke) => {
        if (didInvoke) {
          onDidInvoke?.()
        }
      })
    })

    return () => {
      window.cancelAnimationFrame(submitFrameId)
    }
  }, [agent.control, host.initialAction, initialMessageInput, onDidInvoke])

  const handleApprovalDecision = useCallback(
    async (decision: HITLDecision): Promise<void> => {
      setInputStatus("pending")
      await agent.control.resume(decision)
    },
    [agent.control]
  )
  const clearVisibleError = useCallback((): void => {
    setThreadActionError(null)
    agent.control.clearError()
  }, [agent.control])
  const startFreshDraft = useCallback(async (): Promise<boolean> => {
    try {
      setThreadActionError(null)
      await threadNavigation.startFreshDraft({
        modelId: currentModelId,
        permissionMode: currentPermissionMode
      })
      agent.control.resetInput()
      return true
    } catch (error) {
      setThreadActionError(error instanceof Error ? error.message : String(error))
      return false
    }
  }, [agent.control, currentModelId, currentPermissionMode, threadNavigation])
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
      ...agent.state,
      clearVisibleError,
      visibleError: agent.state.error ?? threadActionError
    },
    branchThread,
    canStop: agent.state.canStop,
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
    retry: agent.control.retry,
    runPrimaryAction,
    selectModel,
    selectPermissionMode,
    setQuery: agent.control.setInput,
    startFreshDraft,
    stop: agent.control.stop,
    threadId
  }
}
