import { ArrowUp, Command, Plus, Square } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PromptInput, PromptInputAction, PromptInputTextarea } from "@/components/agent-ui"
import { LauncherActionOverlay } from "@/features/launcher-actions/LauncherActionOverlay"
import { ComposerApprovalPrompt } from "@/components/chat/ComposerApprovalPrompt"
import { ComposerFollowUpQueue } from "@/components/chat/ComposerFollowUpQueue"
import { useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import { formatShortcutChord } from "@/shortcuts/format-shortcut"
import { AI_LAUNCHER_PLUGIN_ID, AI_THREAD_SOURCE } from "@shared/launcher-ai"
import { AI_ATTACHMENT_FILE_EXTENSIONS } from "@shared/launcher-attachments"
import { MAX_LAUNCHER_SEARCH_RESULTS } from "@shared/launcher"
import { resolveShortcutPlatform } from "@shared/shortcuts/model"
import { LauncherChrome } from "@launcher-components/LauncherChrome"
import { getAiShellConfig } from "./ai-config"
import {
  LauncherAiConversation,
  LauncherAiEmptyState,
  LauncherAiThreadLoadingState
} from "./LauncherAiConversation"
import { LauncherAiHeaderActions } from "./LauncherAiHeaderActions"
import { LauncherAiHeaderLeadingActions } from "./LauncherAiHeaderLeadingActions"
import { LauncherAiHeaderModelPicker } from "./LauncherAiHeaderModelPicker"
import { LauncherAiModelPicker } from "./LauncherAiModelPicker"
import { LauncherAiSidebarPanel } from "./LauncherAiSidebarPanel"
import { LauncherAiThreadSearchOverlay } from "./LauncherAiThreadSearchOverlay"
import { useAiCoreHost } from "./AiCoreHost"
import { LauncherAttachmentStrip } from "./LauncherAttachmentStrip"
import { AssistantSelectionReferencePill } from "@/components/chat/AssistantSelectionReferences"
import { createLauncherAiController } from "./launcher-ai-controller"
import { useAiAttachments } from "./useAiAttachments"
import { useAssistantSelectionRefs } from "@/components/chat/useAssistantSelectionRefs"
import { useLauncherAiActions } from "./useLauncherAiActions"
import { useLauncherAiThreadNavigation } from "./useLauncherAiThreadNavigation"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useI18n } from "@/lib/i18n"
import { useAgent } from "@/lib/use-agent"
import { useThreadContext, useThreadControl, useThreadSelector } from "@/lib/thread-context"
import { updateAgentThreadModel, updateAgentThreadPermissionMode } from "@/lib/agent-control"
import { cn } from "@/lib/utils"
import { useDisableTabNavigation } from "@/lib/use-disable-tab-navigation"
import { OpenTargetProvider } from "@/lib/open-target-context"
import { listNativeLauncherSourceMentions } from "@extension-host/index"
import { isThreadPinned } from "@shared/thread-sidebar"
import { useWorkspaceFileMentions, type ComposerAreaHandle } from "@/composer-area"
import { hasComposerMessageInputContent, type ComposerMessageInput } from "@shared/message-content"
import { shouldGoHomeFromComposerKeyDown } from "./composer-keyboard"
import type { AgentFollowUpQueueItem } from "@shared/agent-thread-runtime"
import type { Subagent, Todo } from "@/types"
import type { LauncherSearchResult } from "@shared/launcher-search"

const AI_SHORTCUT_SCOPES = ["launcher.ai"] as const
const DEFAULT_AGENT_CAN_FORK = true
const EMPTY_SUBAGENTS: readonly Subagent[] = []
const EMPTY_TODOS: readonly Todo[] = []

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function LauncherAiPage(): React.JSX.Element {
  const { copy, locale } = useI18n()
  const sourceMentions = useMemo(
    () => listNativeLauncherSourceMentions(window.electron.process.platform, locale),
    [locale]
  )
  const attachmentDraft = useAiAttachments()
  const host = useAiCoreHost()
  const navigation = host.navigation
  const surface = host.surface
  const showBackButton = host.chrome?.showBackButton ?? true
  const [initialSeedQuery] = useState(host.seedQuery)
  const hasRunInitialActionRef = useRef(false)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const [localComposerText, setLocalComposerText] = useState(() => initialSeedQuery)
  const [approvalRejectFeedback, setApprovalRejectFeedback] = useState("")
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isSidebarPreviewOpen, setIsSidebarPreviewOpen] = useState(false)
  const [isThreadSearchOpen, setIsThreadSearchOpen] = useState(false)
  const [threadSearchQuery, setThreadSearchQuery] = useState("")
  const [threadSearchResults, setThreadSearchResults] = useState<LauncherSearchResult[]>([])
  const [threadSearchActiveIndex, setThreadSearchActiveIndex] = useState(0)
  const [isThreadSearchLoading, setIsThreadSearchLoading] = useState(false)
  const sidebarPreviewCloseTimerRef = useRef<number | null>(null)
  const threadNavigation = useLauncherAiThreadNavigation({
    initialAction: host.initialAction,
    seedQuery: initialSeedQuery
  })
  const threadId = threadNavigation.threadId
  const workspaceFileMentionState = useWorkspaceFileMentions(threadId, mentionQuery)
  const {
    addSelectionRef,
    clearSelectionRefs,
    refs: assistantSelectionRefs,
    removeSelectionRef
  } = useAssistantSelectionRefs(threadId)
  const threadContext = useThreadContext()
  const threadControl = useThreadControl(threadId)
  const draftTarget = threadNavigation.target?.kind === "draft" ? threadNavigation.target : null
  const {
    branchThread: createBranchThread,
    branchThreadUntilMessage,
    canGoToNextThread,
    canGoToPreviousThread,
    createThread,
    defaultDraftPermissionMode,
    goToNextThread,
    goToPreviousThread,
    isHydratingThread,
    openThread,
    startFreshDraft: startFreshDraftTarget,
    threadLoadingReason,
    updateFreshDraft
  } = threadNavigation
  const agent = useAgent({
    threadId
  })
  const {
    control: agentControl,
    view: { canStop, error: agentError, isBusy }
  } = agent
  const { stop } = agentControl
  const {
    addSelectedFiles,
    attachments,
    clearAllAttachments,
    messageRefs: attachmentMessageRefs,
    removeAttachment
  } = attachmentDraft
  const updateThread = useHistoryShellStore((state) => state.updateThread)
  const setThreadPinned = useHistoryShellStore((state) => state.setThreadPinned)
  const setThreadArchived = useHistoryShellStore((state) => state.setThreadArchived)
  const addSidebarProject = useHistoryShellStore((state) => state.addSidebarProject)
  const setSidebarOrganizeMode = useHistoryShellStore((state) => state.setSidebarOrganizeMode)
  const setSidebarSortBy = useHistoryShellStore((state) => state.setSidebarSortBy)
  const loadThreads = useHistoryShellStore((state) => state.loadThreads)
  const sidebarView = useHistoryShellStore((state) => state.sidebarView)
  const { inputRef } = surface
  const focusComposerOnNextFrame = useCallback((): void => {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [inputRef])
  const pendingApproval = useThreadSelector(
    threadId,
    (state) => state?.agent.pendingApproval ?? null
  )
  const followUpQueue = useThreadSelector(threadId, (state) => state?.agent.followUpQueue ?? null)
  const currentModelId =
    useThreadSelector(threadId, (state) => state?.agent.currentModel ?? null) ??
    draftTarget?.modelId ??
    null
  const currentPermissionMode =
    useThreadSelector(threadId, (state) => state?.agent.permissionMode ?? null) ??
    draftTarget?.permissionMode ??
    defaultDraftPermissionMode
  const workspacePath =
    useThreadSelector(threadId, (state) => state?.agent.workspacePath ?? null) ??
    draftTarget?.workspacePath ??
    null
  const subagents = useThreadSelector(
    threadId,
    (state) => state?.agent.subagents ?? EMPTY_SUBAGENTS
  )
  const todos = useThreadSelector(threadId, (state) => state?.agent.todos ?? EMPTY_TODOS)
  const query = localComposerText
  const messageInput = useMemo(
    () => ({
      refs: [...attachmentMessageRefs, ...assistantSelectionRefs],
      text: query
    }),
    [assistantSelectionRefs, attachmentMessageRefs, query]
  )
  const initialMessageInput = useMemo(
    () => ({
      refs: [...attachmentMessageRefs],
      text: initialSeedQuery
    }),
    [attachmentMessageRefs, initialSeedQuery]
  )
  const clearTransientInputState = useCallback((): void => {
    clearAllAttachments()
    clearSelectionRefs()
  }, [clearAllAttachments, clearSelectionRefs])
  const hasPendingApproval = Boolean(pendingApproval)
  const threadError = agentError ?? navigationError
  const canSubmitComposerDraft = !hasPendingApproval && hasComposerMessageInputContent(messageInput)
  const primaryActionDisabled = !canSubmitComposerDraft
  const showStopAction = canStop && !canSubmitComposerDraft
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const hasThreadMessages = useThreadSelector(
    threadId,
    (state) => (state?.view.messageProjection.turns.length ?? 0) > 0
  )
  const currentThreadTitle = useHistoryShellStore((state) => {
    if (!threadId) {
      return null
    }

    return state.threads.find((thread) => thread.thread_id === threadId)?.title ?? null
  })
  const isCurrentThreadPinned = useHistoryShellStore((state) => {
    if (!threadId) {
      return false
    }

    return isThreadPinned(state.threads.find((thread) => thread.thread_id === threadId)?.metadata)
  })
  const currentModelLabel = useHistoryShellStore((state) => {
    if (!currentModelId) {
      return null
    }

    const model = state.models.find((model) => model.id === currentModelId)
    return model?.name ?? model?.model ?? currentModelId
  })
  const currentPermissionLabel =
    currentPermissionMode === "auto"
      ? copy.launcher.permissionModeAuto
      : currentPermissionMode === "explore"
        ? copy.launcher.permissionModeExplore
        : copy.launcher.permissionModeAskToEdit
  const canForkThread = useThreadSelector(
    threadId,
    (state) => state?.agent.forkState.canFork ?? DEFAULT_AGENT_CAN_FORK
  )
  const attachmentCount = attachments.length
  const hasAttachmentDraft = attachmentCount > 0
  const hasAssistantSelectionRefs = assistantSelectionRefs.length > 0
  const isComposerExpanded =
    !pendingApproval && (query.includes("\n") || hasAttachmentDraft || hasAssistantSelectionRefs)
  const shellConfig = getAiShellConfig(surface.shellConfig)
  const isApprovalPending = Boolean(pendingApproval)
  const showFollowUpQueue = Boolean(
    !isApprovalPending && threadId && followUpQueue && followUpQueue.count > 0
  )
  const controller = useMemo(
    () =>
      createLauncherAiController({
        agentControl,
        branchThreadUntilMessage,
        createBranchThread,
        createThread,
        currentModelId,
        currentPermissionMode,
        defaultDraftPermissionMode,
        draftTarget,
        goToNextThread,
        goToPreviousThread,
        hasPendingApproval,
        isBusy,
        onDidInvoke: () => {
          clearTransientInputState()
          setMentionQuery(null)
        },
        setNavigationError,
        setLocalComposerText,
        startFreshDraftTarget,
        threadId,
        title: copy.launcher.aiThreadTitle,
        updateThread,
        updateAgentThreadModel: (commandInput) =>
          updateAgentThreadModel({
            modelId: commandInput.modelId,
            threadContext,
            threadId: commandInput.threadId,
            updateThread: commandInput.updateThread
          }),
        updateAgentThreadPermissionMode: (commandInput) =>
          updateAgentThreadPermissionMode({
            permissionMode: commandInput.permissionMode,
            threadContext,
            threadId: commandInput.threadId,
            updateThread: commandInput.updateThread
          }),
        updateFreshDraft
      }),
    [
      agentControl,
      branchThreadUntilMessage,
      clearTransientInputState,
      copy.launcher.aiThreadTitle,
      createBranchThread,
      createThread,
      currentModelId,
      currentPermissionMode,
      defaultDraftPermissionMode,
      draftTarget,
      goToNextThread,
      goToPreviousThread,
      hasPendingApproval,
      isBusy,
      startFreshDraftTarget,
      threadId,
      threadContext,
      updateFreshDraft,
      updateThread
    ]
  )
  const {
    branchThread,
    clearVisibleError,
    editLastUserMessage,
    goToNextChat,
    goToPreviousChat,
    handleApprovalDecision,
    runPrimaryAction,
    selectModel,
    selectPermissionMode,
    setQuery,
    startFreshDraft
  } = controller
  const canGoToNextChat = canGoToNextThread
  const canGoToPreviousChat = canGoToPreviousThread
  const openAttachmentPicker = useCallback((): void => {
    fileInputRef.current?.click()
  }, [])
  const handleNewQuestion = useCallback(async (): Promise<void> => {
    const didStart = await startFreshDraft()
    if (!didStart) {
      return
    }

    clearTransientInputState()
    setShowModelPicker(false)
    focusComposerOnNextFrame()
  }, [clearTransientInputState, focusComposerOnNextFrame, startFreshDraft])
  const handleBranchChat = useCallback(
    async (messageId?: string): Promise<void> => {
      const nextThreadId = await branchThread(messageId)
      if (!nextThreadId) {
        return
      }

      clearTransientInputState()
      setShowModelPicker(false)
      focusComposerOnNextFrame()
    },
    [branchThread, clearTransientInputState, focusComposerOnNextFrame]
  )
  const handleStop = useCallback(async (): Promise<void> => {
    await stop()
  }, [stop])
  const handleOpenModelPicker = useCallback(async (): Promise<void> => {
    setShowModelPicker(true)
  }, [])
  const getCurrentMessageInput = useCallback((): ComposerMessageInput => {
    const input = inputRef.current
    if (input && "getModelText" in input) {
      return {
        refs: [...input.getRefs(), ...attachmentMessageRefs, ...assistantSelectionRefs],
        text: input.getModelText()
      }
    }

    return {
      refs: [...attachmentMessageRefs, ...assistantSelectionRefs],
      text: query
    }
  }, [assistantSelectionRefs, attachmentMessageRefs, inputRef, query])
  const submitCurrentInput = useCallback((): void => {
    runPrimaryAction(getCurrentMessageInput())
  }, [getCurrentMessageInput, runPrimaryAction])
  const editQueuedFollowUp = useCallback(
    (item: AgentFollowUpQueueItem): void => {
      if (!threadControl) {
        return
      }

      const edited = threadControl.agent.takeFollowUp(item.requestId)
      if (!edited) {
        return
      }

      clearTransientInputState()
      setQuery(edited.messageInput.text)
      setMentionQuery(null)
      focusComposerOnNextFrame()
    },
    [clearTransientInputState, focusComposerOnNextFrame, setQuery, threadControl]
  )
  const deleteQueuedFollowUp = useCallback(
    (item: AgentFollowUpQueueItem): void => {
      if (!threadControl) {
        return
      }

      threadControl.agent.removeFollowUp(item.requestId)
    },
    [threadControl]
  )
  const steerQueuedFollowUp = useCallback(
    async (item: AgentFollowUpQueueItem): Promise<void> => {
      if (!threadControl) {
        return
      }

      const queued = threadControl.agent.takeFollowUp(item.requestId)
      if (!queued) {
        return
      }

      const didInvoke = await agentControl.invoke(queued.messageInput, { followUpAction: "steer" })
      if (!didInvoke) {
        threadControl.agent.restoreFollowUp(queued)
      }
    },
    [agentControl, threadControl]
  )
  const submitApprovalRejectFeedback = useCallback((): void => {
    if (!pendingApproval) {
      return
    }

    const feedback = approvalRejectFeedback.trim()
    void handleApprovalDecision({
      type: "reject",
      ...(feedback ? { feedback } : {})
    })
    setApprovalRejectFeedback("")
  }, [approvalRejectFeedback, handleApprovalDecision, pendingApproval])
  const submitApprovalAccept = useCallback((): void => {
    if (!pendingApproval) {
      return
    }

    void handleApprovalDecision({ type: "approve" })
    setApprovalRejectFeedback("")
  }, [handleApprovalDecision, pendingApproval])
  const handleComposerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>): void => {
      const input = inputRef.current
      const composerText = input && "getModelText" in input ? input.getModelText() : query

      if (
        shouldGoHomeFromComposerKeyDown({
          attachmentCount,
          composerText,
          event
        })
      ) {
        event.preventDefault()
        navigation.goHome()
        return
      }
    },
    [attachmentCount, inputRef, navigation, query]
  )
  const canStartNewQuestion =
    query.trim().length > 0 ||
    attachmentCount > 0 ||
    assistantSelectionRefs.length > 0 ||
    hasThreadMessages
  const canBranchThread = Boolean(threadId && hasThreadMessages && canForkThread)
  const canUseHeaderThreadActions = !isApprovalPending
  const sidebarTitle = currentThreadTitle?.trim() || copy.launcher.newQuestion
  const clearSidebarPreviewCloseTimer = useCallback((): void => {
    if (sidebarPreviewCloseTimerRef.current === null) {
      return
    }

    window.clearTimeout(sidebarPreviewCloseTimerRef.current)
    sidebarPreviewCloseTimerRef.current = null
  }, [])
  const openSidebarPreview = useCallback((): void => {
    clearSidebarPreviewCloseTimer()
    setIsSidebarPreviewOpen(true)
  }, [clearSidebarPreviewCloseTimer])
  const closeSidebarPreview = useCallback((): void => {
    clearSidebarPreviewCloseTimer()
    sidebarPreviewCloseTimerRef.current = window.setTimeout(() => {
      setIsSidebarPreviewOpen(false)
      sidebarPreviewCloseTimerRef.current = null
    }, 120)
  }, [clearSidebarPreviewCloseTimer])
  const toggleSidebar = useCallback((): void => {
    clearSidebarPreviewCloseTimer()
    setIsSidebarPreviewOpen(false)
    setIsSidebarOpen((isOpen) => !isOpen)
  }, [clearSidebarPreviewCloseTimer])
  const handleSidebarPreviewChange = useCallback(
    (isPreviewOpen: boolean): void => {
      if (isSidebarOpen) {
        return
      }

      if (isPreviewOpen) {
        openSidebarPreview()
        return
      }

      closeSidebarPreview()
    },
    [closeSidebarPreview, isSidebarOpen, openSidebarPreview]
  )
  const isSidebarPreviewVisible = isSidebarPreviewOpen && !isSidebarOpen
  useEffect(() => {
    if (!threadId) {
      return
    }

    void loadThreads()
  }, [loadThreads, threadId])
  useEffect(() => {
    if (!isSidebarOpen && !isSidebarPreviewVisible) {
      return
    }

    void loadThreads()
  }, [isSidebarOpen, isSidebarPreviewVisible, loadThreads])
  const trimmedThreadSearchQuery = threadSearchQuery.trim()
  useEffect(() => {
    if (!isThreadSearchOpen || !trimmedThreadSearchQuery) {
      return
    }

    let cancelled = false
    const searchTimer = window.setTimeout(() => {
      setIsThreadSearchLoading(true)
      void window.api.launcher
        .search({
          limit: MAX_LAUNCHER_SEARCH_RESULTS,
          query: trimmedThreadSearchQuery,
          sources: ["threads"],
          threadMetadataSource: AI_THREAD_SOURCE
        })
        .then((response) => {
          if (cancelled) {
            return
          }

          setThreadSearchResults(
            response.results.filter((result) => result.action.type === "open-history-thread")
          )
          setThreadSearchActiveIndex(0)
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return
          }

          console.warn("[LauncherAiPage] Failed to search launcher AI chats:", error)
          setThreadSearchResults([])
          setThreadSearchActiveIndex(0)
        })
        .finally(() => {
          if (!cancelled) {
            setIsThreadSearchLoading(false)
          }
        })
    }, 100)

    return () => {
      cancelled = true
      window.clearTimeout(searchTimer)
    }
  }, [isThreadSearchOpen, trimmedThreadSearchQuery])
  const handleThreadSearchQueryChange = useCallback(
    (nextQuery: string): void => {
      const nextTrimmedThreadSearchQuery = nextQuery.trim()

      setThreadSearchQuery(nextQuery)
      if (nextTrimmedThreadSearchQuery === trimmedThreadSearchQuery) {
        return
      }

      setThreadSearchResults([])
      setThreadSearchActiveIndex(0)
      setIsThreadSearchLoading(nextTrimmedThreadSearchQuery.length > 0)
    },
    [trimmedThreadSearchQuery]
  )
  const sidebarLabels = {
    addProject: copy.launcher.addProject,
    archiveChat: copy.launcher.archiveChat,
    branchIntoLocal: copy.launcher.branchIntoLocal,
    branchIntoNewWorktree: copy.launcher.branchIntoNewWorktree,
    copyDeeplink: copy.launcher.copyDeeplink,
    copySessionId: copy.launcher.copySessionId,
    copyWorkingDirectory: copy.launcher.copyWorkingDirectory,
    expandSidebar: copy.launcher.expandSidebar,
    markAsUnread: copy.launcher.markAsUnread,
    organizeByProject: copy.launcher.organizeByProject,
    organizeByTime: copy.launcher.organizeByTime,
    openThreadInNewWindow: copy.launcher.openThreadInNewWindow,
    pinChat: copy.launcher.pinChat,
    pinProject: copy.launcher.pinProject,
    createPermanentWorktree: copy.launcher.createPermanentWorktree,
    projectOptions: copy.launcher.projectOptions,
    renameChat: copy.launcher.renameChat,
    renameProject: copy.launcher.renameProject,
    removeProject: copy.launcher.removeProject,
    revealInFinder: copy.launcher.revealInFinder,
    sidebarAutomation: copy.launcher.sidebarAutomation,
    sidebarArchiveAllChats: copy.launcher.sidebarArchiveAllChats,
    sidebarChats: copy.launcher.sidebarChats,
    sidebarEmptyPinned: copy.launcher.sidebarEmptyPinned,
    sidebarEmptyProjects: copy.launcher.sidebarEmptyProjects,
    sidebarEmptyRecent: copy.launcher.sidebarEmptyRecent,
    sidebarNewChat: copy.launcher.sidebarNewChat,
    sidebarPinned: copy.launcher.sidebarPinned,
    sidebarProjects: copy.launcher.sidebarProjects,
    sidebarSearch: copy.launcher.sidebarSearch,
    sortByCreated: copy.launcher.sortByCreated,
    sortByManual: copy.launcher.sortByManual,
    sortByUpdated: copy.launcher.sortByUpdated,
    unpinChat: copy.launcher.unpinChat
  }
  const openThreadSearch = useCallback((): void => {
    setThreadSearchQuery("")
    setThreadSearchResults([])
    setThreadSearchActiveIndex(0)
    setIsThreadSearchLoading(false)
    setIsThreadSearchOpen(true)
    void loadThreads()
  }, [loadThreads])
  const closeThreadSearch = useCallback((): void => {
    setIsThreadSearchOpen(false)
    setThreadSearchQuery("")
    setThreadSearchResults([])
    setThreadSearchActiveIndex(0)
    setIsThreadSearchLoading(false)
  }, [])
  const handleSelectSidebarThread = useCallback(
    async (nextThreadId: string): Promise<void> => {
      if (nextThreadId === threadId) {
        return
      }

      await openThread(nextThreadId)
      clearTransientInputState()
      setShowModelPicker(false)
      focusComposerOnNextFrame()
    },
    [clearTransientInputState, focusComposerOnNextFrame, openThread, threadId]
  )
  const handleSelectThreadSearchResult = useCallback(
    async (nextThreadId: string): Promise<void> => {
      closeThreadSearch()
      await handleSelectSidebarThread(nextThreadId)
    },
    [closeThreadSearch, handleSelectSidebarThread]
  )
  const runSidebarThreadAction = useCallback(
    async (action: () => Promise<void>): Promise<void> => {
      try {
        setNavigationError(null)
        await action()
      } catch (error) {
        setNavigationError(toErrorMessage(error))
      }
    },
    []
  )
  const addSidebarProjectFromPicker = useCallback(
    async (): Promise<void> => {
      await runSidebarThreadAction(addSidebarProject)
    },
    [addSidebarProject, runSidebarThreadAction]
  )
  const createProjectSidebarThread = useCallback(
    async (nextWorkspacePath: string): Promise<void> => {
      await runSidebarThreadAction(async () => {
        const didStart = await startFreshDraft({
          workspaceKind: "project",
          workspacePath: nextWorkspacePath
        })
        if (!didStart) {
          return
        }

        clearTransientInputState()
        setShowModelPicker(false)
        focusComposerOnNextFrame()
      })
    },
    [
      clearTransientInputState,
      focusComposerOnNextFrame,
      runSidebarThreadAction,
      startFreshDraft
    ]
  )
  const branchSidebarThread = useCallback(
    async (sourceThreadId: string): Promise<void> => {
      await runSidebarThreadAction(async () => {
        await createBranchThread(sourceThreadId)
        clearTransientInputState()
        setShowModelPicker(false)
        focusComposerOnNextFrame()
      })
    },
    [clearTransientInputState, createBranchThread, focusComposerOnNextFrame, runSidebarThreadAction]
  )
  const copySidebarThreadSessionId = useCallback(
    async (nextThreadId: string): Promise<void> => {
      await runSidebarThreadAction(async () => {
        await navigator.clipboard.writeText(nextThreadId)
      })
    },
    [runSidebarThreadAction]
  )
  const copySidebarThreadWorkingDirectory = useCallback(
    async (nextWorkspacePath: string): Promise<void> => {
      await runSidebarThreadAction(async () => {
        await navigator.clipboard.writeText(nextWorkspacePath)
      })
    },
    [runSidebarThreadAction]
  )
  const openSidebarThreadInNewWindow = useCallback(
    async (nextThreadId: string): Promise<void> => {
      await runSidebarThreadAction(async () => {
        const result = await window.api.aiSessionWindows.openPinned({ threadId: nextThreadId })
        if (!result.ok) {
          console.warn("[LauncherAiPage] Pinned AI session window limit reached.", {
            limit: result.limit
          })
        }
      })
    },
    [runSidebarThreadAction]
  )
  const revealSidebarThreadInFinder = useCallback(
    async (nextWorkspacePath: string): Promise<void> => {
      await runSidebarThreadAction(async () => {
        await window.api.openTargets.open({ folderPath: nextWorkspacePath, targetId: "finder" })
      })
    },
    [runSidebarThreadAction]
  )
  const toggleSidebarThreadPinned = useCallback(
    async (nextThreadId: string, pinned: boolean): Promise<void> => {
      await runSidebarThreadAction(async () => {
        await setThreadPinned(nextThreadId, pinned)
      })
    },
    [runSidebarThreadAction, setThreadPinned]
  )
  const archiveSidebarThread = useCallback(
    async (nextThreadId: string): Promise<void> => {
      await runSidebarThreadAction(async () => {
        await setThreadArchived(nextThreadId, true)
        if (nextThreadId === threadId) {
          const didStart = await startFreshDraft()
          if (didStart) {
            clearTransientInputState()
            setShowModelPicker(false)
            focusComposerOnNextFrame()
          }
        }
      })
    },
    [
      clearTransientInputState,
      focusComposerOnNextFrame,
      runSidebarThreadAction,
      setThreadArchived,
      startFreshDraft,
      threadId
    ]
  )
  const sidebarThreadMenuActions = useMemo(
    () => ({
      onArchive: archiveSidebarThread,
      onBranchIntoLocal: branchSidebarThread,
      onCopySessionId: copySidebarThreadSessionId,
      onCopyWorkingDirectory: copySidebarThreadWorkingDirectory,
      onOpenInNewWindow: openSidebarThreadInNewWindow,
      onRevealInFinder: revealSidebarThreadInFinder,
      onTogglePinned: toggleSidebarThreadPinned
    }),
    [
      archiveSidebarThread,
      branchSidebarThread,
      copySidebarThreadSessionId,
      copySidebarThreadWorkingDirectory,
      openSidebarThreadInNewWindow,
      revealSidebarThreadInFinder,
      toggleSidebarThreadPinned
    ]
  )
  const sidebarProjectActions = useMemo(
    () => ({
      onCopyWorkingDirectory: copySidebarThreadWorkingDirectory,
      onCreateChat: createProjectSidebarThread,
      onRevealInFinder: revealSidebarThreadInFinder
    }),
    [copySidebarThreadWorkingDirectory, createProjectSidebarThread, revealSidebarThreadInFinder]
  )
  const handleGoToNextChat = useCallback(async (): Promise<void> => {
    const nextThreadId = await goToNextChat()
    if (!nextThreadId) {
      return
    }

    clearTransientInputState()
    setShowModelPicker(false)
    focusComposerOnNextFrame()
  }, [clearTransientInputState, focusComposerOnNextFrame, goToNextChat])
  const handleGoToPreviousChat = useCallback(async (): Promise<void> => {
    const previousThreadId = await goToPreviousChat()
    if (!previousThreadId) {
      return
    }

    clearTransientInputState()
    setShowModelPicker(false)
    focusComposerOnNextFrame()
  }, [clearTransientInputState, focusComposerOnNextFrame, goToPreviousChat])
  const openMainChat = useCallback(async (): Promise<void> => {
    if (!threadId) {
      return
    }

    const result = await window.api.aiSessionWindows.openPinned({ threadId })
    if (!result.ok) {
      console.warn("[LauncherAiPage] Pinned AI session window limit reached.", {
        limit: result.limit
      })
    }
    await navigation.hideLauncher()
  }, [navigation, threadId])
  const openPinnedWindow = useCallback(async (): Promise<void> => {
    if (!threadId) {
      return
    }

    const result = await window.api.aiSessionWindows.openPinned({ threadId })
    if (!result.ok) {
      console.warn("[LauncherAiPage] Pinned AI session window limit reached.", {
        limit: result.limit
      })
    }
  }, [threadId])
  const copyWorkingDirectory = useCallback(async (): Promise<void> => {
    if (!workspacePath) {
      return
    }

    await navigator.clipboard.writeText(workspacePath)
  }, [workspacePath])
  const copySessionId = useCallback(async (): Promise<void> => {
    if (!threadId) {
      return
    }

    await navigator.clipboard.writeText(threadId)
  }, [threadId])
  const toggleCurrentThreadPinned = useCallback(async (): Promise<void> => {
    if (!threadId) {
      return
    }

    await setThreadPinned(threadId, !isCurrentThreadPinned)
  }, [isCurrentThreadPinned, setThreadPinned, threadId])
  const { actionController, addAttachmentShortcut, submitShortcut } = useLauncherAiActions({
    branchThread: handleBranchChat,
    canBranchThread,
    canGoToNextChat,
    canGoToPreviousChat,
    canStartNewQuestion,
    copy: copy.launcher,
    currentPermissionMode,
    goToNextChat: handleGoToNextChat,
    goToPreviousChat: handleGoToPreviousChat,
    inputRef,
    isApprovalPending,
    isBusy,
    navigateHome: navigation.goHome,
    newQuestion: handleNewQuestion,
    openAttachmentPicker,
    openMainChat,
    openModelPicker: handleOpenModelPicker,
    query,
    runPrimaryAction: submitCurrentInput,
    selectPermissionMode
  })
  const submitShortcutLabel =
    submitShortcut ??
    formatShortcutChord(
      {
        modifiers: [],
        key: "Enter"
      },
      resolveShortcutPlatform(window.electron.process.platform)
    )

  useShortcutScopeLayer(AI_SHORTCUT_SCOPES)
  useDisableTabNavigation(inputRef)

  useEffect(() => {
    return () => clearSidebarPreviewCloseTimer()
  }, [clearSidebarPreviewCloseTimer])

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
      runPrimaryAction(initialMessageInput)
    })

    return () => {
      window.cancelAnimationFrame(submitFrameId)
    }
  }, [host.initialAction, initialMessageInput, runPrimaryAction])

  return (
    <OpenTargetProvider folderPath={workspacePath}>
      <div className="relative h-full">
        <LauncherChrome
          headerLeading={
            <LauncherAiHeaderLeadingActions
              canGoToNextChat={canUseHeaderThreadActions && canGoToNextChat}
              canGoToPreviousChat={canUseHeaderThreadActions && canGoToPreviousChat}
              canStartNewQuestion={canUseHeaderThreadActions && canStartNewQuestion}
              isSidebarOpen={isSidebarOpen}
              labels={{
                collapseSidebar: copy.launcher.collapseSidebar,
                expandSidebar: copy.launcher.expandSidebar,
                goHome: copy.launcher.goHome,
                goToNextChat: copy.launcher.goToNextChat,
                goToPreviousChat: copy.launcher.goToPreviousChat,
                newQuestion: copy.launcher.newQuestion
              }}
              showBackButton={showBackButton}
              title={sidebarTitle}
              titleAccessory={
                <LauncherAiHeaderModelPicker
                  currentModelId={currentModelId}
                  fallbackLabel={copy.launcher.aiThreadTitle}
                  onSelectModel={selectModel}
                />
              }
              onGoToNextChat={() => {
                void handleGoToNextChat()
              }}
              onGoToPreviousChat={() => {
                void handleGoToPreviousChat()
              }}
              onGoHome={navigation.goHome}
              onNewQuestion={() => {
                void handleNewQuestion()
              }}
              onSidebarPreviewChange={handleSidebarPreviewChange}
              onToggleSidebar={toggleSidebar}
            />
          }
          headerTrailing={
            <LauncherAiHeaderActions
              canBranchThread={canUseHeaderThreadActions && canBranchThread}
              canOpenThreadMenu={canUseHeaderThreadActions}
              canOpenPinnedWindow={canUseHeaderThreadActions && Boolean(threadId)}
              isPinned={isCurrentThreadPinned}
              environment={{
                modelLabel: currentModelLabel,
                permissionLabel: currentPermissionLabel,
                subagents,
                threadId,
                todos,
                workspacePath
              }}
              labels={{
                addAutomation: copy.launcher.addAutomation,
                actions: copy.launcher.actionsLabel,
                branchIntoLocal: copy.launcher.branchIntoLocal,
                branchIntoNewWorktree: copy.launcher.branchIntoNewWorktree,
                branchIntoSameWorktree: copy.launcher.branchIntoSameWorktree,
                branchMenu: copy.launcher.branchMenu,
                copyAsMarkdown: copy.launcher.copyAsMarkdown,
                copyChat: copy.launcher.copyChat,
                copyDeeplink: copy.launcher.copyDeeplink,
                copySessionId: copy.launcher.copySessionId,
                copyWorkingDirectory: copy.launcher.copyWorkingDirectory,
                environmentInfo: copy.launcher.environmentInfo,
                environmentModel: copy.launcher.environmentModel,
                environmentNoModel: copy.launcher.environmentNoModel,
                environmentNoThread: copy.launcher.environmentNoThread,
                environmentNoWorkspace: copy.launcher.environmentNoWorkspace,
                environmentPermission: copy.launcher.environmentPermission,
                environmentProgress: copy.launcher.environmentProgress,
                environmentProgressMore: copy.launcher.environmentProgressMore,
                environmentSubagents: copy.launcher.environmentSubagents,
                environmentSubagentStatuses: {
                  completed: copy.common.completed,
                  failed: copy.common.error,
                  pending: copy.launcher.planned,
                  running: copy.common.running
                },
                environmentThread: copy.launcher.environmentThread,
                environmentWorkspace: copy.launcher.environmentWorkspace,
                openFolder: copy.launcher.openFolder,
                openPinnedWindow: copy.launcher.openPinnedWindow,
                openSideChat: copy.launcher.openSideChat,
                openTarget: copy.launcher.openTarget,
                pinChat: copy.launcher.pinChat,
                renameChat: copy.launcher.renameChat,
                underDevelopment: copy.launcher.underDevelopment,
                unpinChat: copy.launcher.unpinChat
              }}
              onBranchIntoLocal={() => {
                void handleBranchChat()
              }}
              onCopySessionId={() => {
                void copySessionId()
              }}
              onCopyWorkingDirectory={() => {
                void copyWorkingDirectory()
              }}
              onOpenPinnedWindow={() => {
                void openPinnedWindow()
              }}
              onTogglePinned={() => {
                void toggleCurrentThreadPinned()
              }}
            />
          }
          hideInputChrome
          inputValue={query}
          onInputValueChange={setQuery}
          placeholders={[
            copy.launcher.aiInputPlaceholder,
            copy.launcher.aiInputPlaceholderSecondary
          ]}
          shellConfig={shellConfig}
          surface={AI_LAUNCHER_PLUGIN_ID}
        >
          <div className="launcher-ai-body" data-sidebar-open={isSidebarOpen ? "" : undefined}>
            {isSidebarOpen ? (
              <LauncherAiSidebarPanel
                activeThreadId={threadId}
                labels={sidebarLabels}
                locale={locale}
                mode="expanded"
                sidebarView={sidebarView}
                projectActions={sidebarProjectActions}
                threadMenuActions={sidebarThreadMenuActions}
                onAddProject={addSidebarProjectFromPicker}
                onNewChat={() => {
                  void handleNewQuestion()
                }}
                onOpenSearch={openThreadSearch}
                onSelectThread={(nextThreadId) => {
                  void handleSelectSidebarThread(nextThreadId)
                }}
                onSetSidebarOrganizeMode={setSidebarOrganizeMode}
                onSetSidebarSortBy={setSidebarSortBy}
              />
            ) : null}
            {isSidebarPreviewVisible ? (
              <LauncherAiSidebarPanel
                activeThreadId={threadId}
                labels={sidebarLabels}
                locale={locale}
                mode="preview"
                sidebarView={sidebarView}
                projectActions={sidebarProjectActions}
                threadMenuActions={sidebarThreadMenuActions}
                onAddProject={addSidebarProjectFromPicker}
                onNewChat={() => {
                  void handleNewQuestion()
                }}
                onOpenSearch={openThreadSearch}
                onPointerEnter={openSidebarPreview}
                onPointerLeave={closeSidebarPreview}
                onSelectThread={(nextThreadId) => {
                  void handleSelectSidebarThread(nextThreadId)
                }}
                onSetSidebarOrganizeMode={setSidebarOrganizeMode}
                onSetSidebarSortBy={setSidebarSortBy}
              />
            ) : null}
            <div className="launcher-ai-main min-w-0 flex-1">
              {threadId ? (
                <LauncherAiConversation
                  clearError={clearVisibleError}
                  error={threadError}
                  isHydrating={isHydratingThread}
                  isLoading={isBusy}
                  loadingReason={threadLoadingReason}
                  onAddAssistantSelectionRef={addSelectionRef}
                  onBranch={handleBranchChat}
                  onEditLastUserMessage={editLastUserMessage}
                  onRetry={runPrimaryAction}
                  threadId={threadId}
                />
              ) : isHydratingThread ? (
                <LauncherAiThreadLoadingState reason={threadLoadingReason} />
              ) : (
                <LauncherAiEmptyState error={threadError} />
              )}
              <form
                className="launcher-ai-composer-footer shrink-0 px-[var(--launcher-ai-composer-page-x)] pb-[var(--ow-space-2)]"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!isApprovalPending) {
                    submitCurrentInput()
                  }
                }}
              >
                {pendingApproval ? (
                  <div className="mx-auto w-full max-w-[var(--launcher-ai-content-max-width)]">
                    <ComposerApprovalPrompt
                      actionsPlacement="external"
                      key={pendingApproval.id}
                      onDecision={(decision) => {
                        void handleApprovalDecision(decision)
                        setApprovalRejectFeedback("")
                      }}
                      rejectFeedback={approvalRejectFeedback}
                      rejectFeedbackPlacement="external"
                      request={pendingApproval}
                      variant="composer-tray"
                    />
                  </div>
                ) : null}
                {!isApprovalPending && threadId && followUpQueue ? (
                  <ComposerFollowUpQueue
                    className="mx-auto w-full max-w-[var(--launcher-ai-content-max-width)]"
                    onDeleteQueuedFollowUp={deleteQueuedFollowUp}
                    onEditQueuedFollowUp={editQueuedFollowUp}
                    onSteerQueuedFollowUp={steerQueuedFollowUp}
                    queue={followUpQueue}
                  />
                ) : null}
                <PromptInput
                  className={cn(
                    "mx-auto w-full max-w-[var(--launcher-ai-content-max-width)] px-[var(--ow-space-2)] py-[var(--ow-space-1)]",
                    (isApprovalPending || showFollowUpQueue) && "rounded-t-none border-t-0"
                  )}
                  style={{ backgroundColor: "var(--background-elevated)" }}
                  isLoading={isBusy}
                  maxHeight="var(--launcher-ai-composer-input-max-h)"
                  minHeight="var(--launcher-ai-composer-input-min-h)"
                  onSubmit={isApprovalPending ? undefined : submitCurrentInput}
                  onValueChange={isApprovalPending ? setApprovalRejectFeedback : setQuery}
                  value={isApprovalPending ? approvalRejectFeedback : query}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    accept={AI_ATTACHMENT_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(
                      ","
                    )}
                    onChange={(event) => {
                      if (event.target.files) {
                        void addSelectedFiles(event.target.files)
                      }
                      event.target.value = ""
                    }}
                  />

                  <div
                    className={`flex min-w-0 gap-[var(--ow-gap-sm)] ${
                      isComposerExpanded ? "items-end" : "items-center"
                    }`}
                  >
                    {!isApprovalPending ? (
                      <PromptInputAction
                        onClick={openAttachmentPicker}
                        onMouseDown={(event) => event.preventDefault()}
                        icon={<Plus className="size-[var(--ow-icon-xs)]" />}
                        label={copy.launcher.aiAddAttachment}
                        title={
                          addAttachmentShortcut
                            ? `${copy.launcher.aiAddAttachment} (${addAttachmentShortcut})`
                            : copy.launcher.aiAddAttachment
                        }
                        tooltip={copy.launcher.aiAddAttachment}
                      />
                    ) : null}

                    <div className="flex min-w-0 flex-1 flex-col gap-[var(--ow-space-1)]">
                      <PromptInputTextarea
                        composerRef={inputRef as React.RefObject<ComposerAreaHandle | null>}
                        mode="composer"
                        onMentionQueryChange={setMentionQuery}
                        onKeyDown={handleComposerKeyDown}
                        onSubmit={isApprovalPending ? undefined : submitCurrentInput}
                        placeholder={
                          isApprovalPending
                            ? copy.toolCall.rejectFeedbackPlaceholder
                            : copy.launcher.aiInputPlaceholder
                        }
                        sourceMentions={isApprovalPending ? [] : sourceMentions}
                        workspaceFileMentions={
                          isApprovalPending ? [] : workspaceFileMentionState.files
                        }
                        workspaceFileSearchEnabled={
                          isApprovalPending ? false : workspaceFileMentionState.searchEnabled
                        }
                        workspaceFileSearchIncomplete={
                          isApprovalPending ? false : workspaceFileMentionState.isIncomplete
                        }
                        workspaceFileSearchInProgress={
                          isApprovalPending ? false : workspaceFileMentionState.isSearching
                        }
                        className="w-full py-[7px] [font-size:var(--ow-font-control)] font-normal"
                      />

                      {!isApprovalPending ? (
                        <>
                          <LauncherAttachmentStrip
                            attachments={attachments}
                            onRemove={removeAttachment}
                          />
                          <AssistantSelectionReferencePill
                            className="px-[var(--ow-space-1)]"
                            refs={assistantSelectionRefs}
                            removable
                            onClear={clearSelectionRefs}
                            onRemove={removeSelectionRef}
                          />
                        </>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-[var(--ow-gap-sm)]">
                      {isApprovalPending ? (
                        <>
                          <button
                            type="button"
                            className="min-h-8 rounded-full px-[var(--ow-space-2-5)] [font-size:var(--ow-font-body)] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={submitApprovalRejectFeedback}
                          >
                            {copy.toolCall.decline}
                          </button>
                          <button
                            type="button"
                            className="min-h-8 rounded-full bg-foreground px-[var(--ow-space-3)] [font-size:var(--ow-font-body)] font-semibold text-background shadow-[0_6px_16px_rgba(32,38,45,0.14)] transition-transform hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
                            onClick={submitApprovalAccept}
                          >
                            {copy.toolCall.accept}
                          </button>
                        </>
                      ) : null}

                      {actionController.canOpenActions && !isApprovalPending ? (
                        <PromptInputAction
                          onClick={() => actionController.openActions()}
                          onMouseDown={(event) => event.preventDefault()}
                          icon={<Command className="size-[var(--ow-icon-sm)]" />}
                          label={copy.launcher.actionsLabel}
                          title={
                            actionController.actionPanelShortcut
                              ? `${copy.launcher.actionsLabel} (${actionController.actionPanelShortcut})`
                              : copy.launcher.actionsLabel
                          }
                          tooltip={
                            actionController.actionPanelShortcut
                              ? `${copy.launcher.actionsLabel} (${actionController.actionPanelShortcut})`
                              : copy.launcher.actionsLabel
                          }
                        />
                      ) : null}

                      {showStopAction && !isApprovalPending ? (
                        <PromptInputAction
                          onClick={() => {
                            void handleStop()
                          }}
                          onMouseDown={(event) => event.preventDefault()}
                          icon={<Square className="size-[var(--ow-icon-compact)]" />}
                          label={copy.launcher.aiStopLabel}
                          title={copy.launcher.aiStopLabel}
                          tooltip={copy.launcher.aiStopLabel}
                        />
                      ) : !isApprovalPending ? (
                        <PromptInputAction
                          onClick={submitCurrentInput}
                          onMouseDown={(event) => event.preventDefault()}
                          disabled={primaryActionDisabled}
                          icon={<ArrowUp className="size-[var(--ow-icon-sm)]" />}
                          label={copy.launcher.aiPrimaryLabel}
                          title={`${copy.launcher.aiPrimaryLabel} (${submitShortcutLabel})`}
                          tooltip={`${copy.launcher.aiPrimaryLabel} (${submitShortcutLabel})`}
                          className="text-foreground enabled:bg-background-secondary/72 enabled:hover:bg-background-secondary disabled:bg-transparent"
                        />
                      ) : null}
                    </div>
                  </div>
                </PromptInput>
              </form>
            </div>
          </div>
        </LauncherChrome>

        {actionController.showActions && actionController.canOpenActions ? (
          <LauncherActionOverlay
            actions={actionController.actions}
            onClose={actionController.closeActions}
          />
        ) : null}

        {showModelPicker ? (
          <LauncherAiModelPicker
            currentModelId={currentModelId}
            onClose={() => setShowModelPicker(false)}
            onSelectModel={selectModel}
          />
        ) : null}

        {isThreadSearchOpen ? (
          <LauncherAiThreadSearchOverlay
            activeIndex={threadSearchActiveIndex}
            currentThreadId={threadId}
            isLoading={isThreadSearchLoading}
            labels={{
              search: copy.launcher.sidebarSearch,
              searchLoading: copy.launcher.sidebarSearchLoading,
              searchNoResults: copy.launcher.sidebarSearchNoResults
            }}
            onActiveIndexChange={setThreadSearchActiveIndex}
            onClose={closeThreadSearch}
            onQueryChange={handleThreadSearchQueryChange}
            onSelectThread={(nextThreadId) => {
              void handleSelectThreadSearchResult(nextThreadId)
            }}
            query={threadSearchQuery}
            results={threadSearchResults}
          />
        ) : null}
      </div>
    </OpenTargetProvider>
  )
}
