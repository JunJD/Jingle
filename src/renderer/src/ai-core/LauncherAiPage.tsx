import { ArrowUp, Command, Plus, Square } from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from "react"
import { PromptInput, PromptInputAction, PromptInputTextarea } from "@/components/agent-ui"
import { LauncherActionOverlay } from "@/features/launcher-actions/LauncherActionOverlay"
import { ComposerApprovalPrompt } from "@/components/chat/ComposerApprovalPrompt"
import { ComposerFollowUpQueue } from "@/components/chat/ComposerFollowUpQueue"
import { useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import { formatShortcutChord } from "@/shortcuts/format-shortcut"
import { AI_LAUNCHER_PLUGIN_ID, AI_THREAD_SOURCE } from "@shared/launcher-ai"
import { AI_ATTACHMENT_IMAGE_EXTENSIONS } from "@shared/launcher-attachments"
import { MAX_LAUNCHER_SEARCH_RESULTS } from "@shared/launcher"
import { resolveShortcutPlatform } from "@shared/shortcuts/model"
import { LauncherChrome } from "@launcher-components/LauncherChrome"
import { ClipboardChip } from "@launcher-components/ClipboardChip"
import { SelectionContextChip } from "@launcher-components/SelectionContextChip"
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
import { useAiCoreHost, useAiCoreLifecycle } from "./AiCoreHost"
import { LauncherAttachmentStrip } from "./LauncherAttachmentStrip"
import { AssistantSelectionReferencePill } from "@/components/chat/AssistantSelectionReferences"
import { AssistantSelectionReferenceNavigationProvider } from "@/components/chat/AssistantSelectionReferenceNavigation"
import {
  createLauncherAiController,
  createLauncherComposerRevisionLedger,
  createLauncherCommandSubmissionGate,
  isLauncherCommandTargetCurrent
} from "./launcher-ai-controller"
import { useAiAttachments } from "./useAiAttachments"
import { useAssistantSelectionRefs } from "@/components/chat/useAssistantSelectionRefs"
import { useLauncherAiActions } from "./useLauncherAiActions"
import { useLauncherAiThreadNavigation } from "./useLauncherAiThreadNavigation"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useI18n } from "@/lib/i18n"
import { useAgent } from "@/lib/use-agent"
import { useThreadContext, useThreadControl, useThreadSelector } from "@/lib/thread-context"
import {
  stopAgentThread,
  updateAgentThreadModel,
  updateAgentThreadPermissionMode,
  type AgentCommandActivity
} from "@/lib/agent-control"
import { cn } from "@/lib/utils"
import { useDisableTabNavigation } from "@/lib/use-disable-tab-navigation"
import { OpenTargetProvider } from "@/lib/open-target-context"
import { listNativeLauncherSourceMentions } from "@extension-host/index"
import { isThreadPinned } from "@shared/thread-sidebar"
import { useWorkspaceFileMentions, type ComposerAreaHandle } from "@/composer-area"
import { hasComposerMessageInputContent, type ComposerMessageInput } from "@shared/message-content"
import { areComposerCommandInputsEqual } from "@shared/agent-command"
import {
  buildLauncherSelectionPromptText,
  type LauncherSelectionContext
} from "@shared/launcher-selection"
import { shouldGoHomeFromComposerKeyDown } from "./composer-keyboard"
import type { JingleAgentFollowUpQueueItem } from "@jingle/agent-client"
import type { Todo } from "@/types"
import type { LauncherSearchResult } from "@shared/launcher-search"

const AI_SHORTCUT_SCOPES = ["launcher.ai"] as const
const DEFAULT_AGENT_CAN_FORK = true
const EMPTY_TODOS: readonly Todo[] = []

function getApprovalSubmissionKey(threadId: string, approvalId: string): string {
  return JSON.stringify([threadId, approvalId])
}

function useLatestCallback<TResult>(callback: () => TResult): () => TResult {
  const callbackRef = useRef(callback)
  useLayoutEffect(() => {
    callbackRef.current = callback
  }, [callback])
  return useCallback(() => callbackRef.current(), [])
}

interface ThreadSearchState {
  activeIndex: number
  isLoading: boolean
  isOpen: boolean
  query: string
  results: LauncherSearchResult[]
}

type ThreadSearchAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "query"; query: string }
  | { type: "active-index"; activeIndex: number }
  | { type: "search-start" }
  | { type: "search-success"; results: LauncherSearchResult[] }
  | { type: "search-failure" }

const INITIAL_THREAD_SEARCH_STATE: ThreadSearchState = {
  activeIndex: 0,
  isLoading: false,
  isOpen: false,
  query: "",
  results: []
}

function threadSearchReducer(
  state: ThreadSearchState,
  action: ThreadSearchAction
): ThreadSearchState {
  switch (action.type) {
    case "open":
      return {
        ...INITIAL_THREAD_SEARCH_STATE,
        isOpen: true
      }
    case "close":
      return INITIAL_THREAD_SEARCH_STATE
    case "query": {
      const currentTrimmedQuery = state.query.trim()
      const nextTrimmedQuery = action.query.trim()

      if (nextTrimmedQuery === currentTrimmedQuery) {
        return {
          ...state,
          query: action.query
        }
      }

      return {
        ...state,
        activeIndex: 0,
        isLoading: nextTrimmedQuery.length > 0,
        query: action.query,
        results: []
      }
    }
    case "active-index":
      return {
        ...state,
        activeIndex: action.activeIndex
      }
    case "search-start":
      return {
        ...state,
        isLoading: true
      }
    case "search-success":
      return {
        ...state,
        activeIndex: 0,
        isLoading: false,
        results: action.results
      }
    case "search-failure":
      return {
        ...state,
        activeIndex: 0,
        isLoading: false,
        results: []
      }
  }
}

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
  const isPinnedThreadSurface = host.threads.mode === "pinned-thread"
  const autoOpenSidebarMinWidth = host.chrome?.autoOpenSidebarMinWidth
  const selection = host.selection
  let selectionContext: LauncherSelectionContext | null = null
  if (selection) {
    selectionContext = selection.context
  }
  const showBackButton = host.chrome?.showBackButton ?? true
  const [initialSeedQuery] = useState(host.seedQuery)
  const hasRunInitialActionRef = useRef(false)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const [localComposerText, setLocalComposerText] = useState(() => initialSeedQuery)
  const [composerRevision] = useState(createLauncherComposerRevisionLedger)
  const markComposerChanged = useCallback((): void => {
    composerRevision.markChanged()
  }, [composerRevision])
  const setComposerText = useCallback(
    (value: string): void => {
      markComposerChanged()
      setLocalComposerText(value)
    },
    [markComposerChanged]
  )
  const [approvalRejectFeedback, setApprovalRejectFeedback] = useState("")
  const approvalFeedbackRevisionRef = useRef(0)
  const setApprovalFeedback = useCallback((value: string): void => {
    approvalFeedbackRevisionRef.current += 1
    setApprovalRejectFeedback(value)
  }, [])
  const [pendingCommands, setPendingCommands] = useState<ReadonlyMap<string, AgentCommandActivity>>(
    () => new Map()
  )
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [isComposerInputOverflowing, setIsComposerInputOverflowing] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (host.chrome?.initialSidebarOpen === true) {
      return true
    }

    return false
  })
  const [isSidebarPreviewOpen, setIsSidebarPreviewOpen] = useState(false)
  const [threadSearch, dispatchThreadSearch] = useReducer(
    threadSearchReducer,
    INITIAL_THREAD_SEARCH_STATE
  )
  const sidebarPreviewCloseTimerRef = useRef<number | null>(null)
  const threadNavigation = useLauncherAiThreadNavigation({
    initialAction: host.initialAction,
    seedQuery: initialSeedQuery
  })
  const threadId = threadNavigation.threadId
  const handleCommandAdmitted = useCallback((activity: AgentCommandActivity): void => {
    setPendingCommands((currentActivities) => {
      const nextActivities = new Map(currentActivities)
      nextActivities.set(activity.threadId, activity)
      return nextActivities
    })
  }, [])
  const handleCommandSettled = useCallback((activity: AgentCommandActivity): void => {
    setPendingCommands((currentActivities) => {
      if (currentActivities.get(activity.threadId)?.commandId !== activity.commandId) {
        return currentActivities
      }
      const nextActivities = new Map(currentActivities)
      nextActivities.delete(activity.threadId)
      return nextActivities
    })
  }, [])
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
    onCommandAdmitted: handleCommandAdmitted,
    onCommandSettled: handleCommandSettled,
    threadId
  })
  const {
    control: agentControl,
    view: { canStop: runtimeCanStop, error: agentError, isBusy: runtimeIsBusy }
  } = agent
  const { stop } = agentControl
  const pendingCommandForCurrentThread = threadId ? (pendingCommands.get(threadId) ?? null) : null
  const hasPendingCommand = pendingCommands.size > 0
  const hasPendingCurrentCommand = pendingCommandForCurrentThread !== null
  const canStop = runtimeCanStop || hasPendingCurrentCommand
  const isBusy = runtimeIsBusy || hasPendingCurrentCommand
  const {
    acceptClipboardAttachments,
    addSelectedFiles,
    attachments,
    clipboardCandidateAttachments,
    clearAllAttachments,
    messageRefs: attachmentMessageRefs,
    removeAttachment
  } = attachmentDraft
  const clearClipboardContext = host.clipboard.clearContext
  const clipboardCandidateContext = host.clipboard.candidateContext
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
  const projectedPendingApproval = useThreadSelector(
    threadId,
    (state) => state?.agent.pendingApproval ?? null
  )
  const [settledApprovalKeys, setSettledApprovalKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const projectedApprovalKey =
    threadId && projectedPendingApproval
      ? getApprovalSubmissionKey(threadId, projectedPendingApproval.id)
      : null
  const pendingApproval =
    projectedApprovalKey && settledApprovalKeys.has(projectedApprovalKey)
      ? null
      : projectedPendingApproval
  const followUpQueue = useThreadSelector(threadId, (state) => state?.agent.followUpQueue ?? null)
  const activeRun = useThreadSelector(threadId, (state) => state?.agent.activeRun ?? null)
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
  const todos = useThreadSelector(threadId, (state) => state?.agent.todos ?? EMPTY_TODOS)
  const query = localComposerText
  const getCurrentMessageInput = useCallback((): ComposerMessageInput => {
    const input = inputRef.current
    const refs =
      input && "getModelText" in input
        ? [...input.getRefs(), ...attachmentMessageRefs, ...assistantSelectionRefs]
        : [...attachmentMessageRefs, ...assistantSelectionRefs]
    const text = input && "getModelText" in input ? input.getModelText() : query

    if (selectionContext) {
      return {
        refs,
        text: buildLauncherSelectionPromptText({
          selection: selectionContext,
          userText: text
        })
      }
    }

    return {
      refs,
      text
    }
  }, [assistantSelectionRefs, attachmentMessageRefs, inputRef, query, selectionContext])
  const getLatestCurrentMessageInput = useLatestCallback(getCurrentMessageInput)
  const getLatestTarget = useLatestCallback(() => threadNavigation.target)
  useAiCoreLifecycle({
    onLauncherShown: () => {
      if (host.threads.mode !== "launcher" || !threadId) {
        return
      }

      void threadContext.loadThreadData(threadId)
    }
  })
  const messageInput = useMemo(() => {
    const refs = [...attachmentMessageRefs, ...assistantSelectionRefs]
    const text = selectionContext
      ? buildLauncherSelectionPromptText({
          selection: selectionContext,
          userText: query
        })
      : query

    return {
      refs,
      text
    }
  }, [assistantSelectionRefs, attachmentMessageRefs, query, selectionContext])
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
  const handleAcceptedComposerInput = useCallback(
    (submittedInput: ComposerMessageInput, acceptedThreadId: string): void => {
      if (!composerRevision.takeIfCurrent(submittedInput)) {
        return
      }

      const submittedTarget = threadNavigation.target
      const latestTarget = getLatestTarget()
      if (
        !isLauncherCommandTargetCurrent({
          acceptedThreadId,
          currentTarget: latestTarget,
          submittedTarget
        })
      ) {
        return
      }

      if (!areComposerCommandInputsEqual(getLatestCurrentMessageInput(), submittedInput)) {
        return
      }

      setComposerText("")
      clearTransientInputState()
      if (selection && selectionContext) {
        void selection.clearContext(selectionContext.id)
      }
      setMentionQuery(null)
    },
    [
      clearTransientInputState,
      composerRevision,
      getLatestCurrentMessageInput,
      getLatestTarget,
      selection,
      selectionContext,
      setComposerText,
      threadNavigation.target
    ]
  )
  const hasPendingApproval = Boolean(pendingApproval)
  const threadError = agentError ?? navigationError
  const canSubmitComposerDraft = !hasPendingApproval && hasComposerMessageInputContent(messageInput)
  const primaryActionDisabled = hasPendingCommand || !canSubmitComposerDraft
  const showStopAction = canStop && (hasPendingCurrentCommand || !canSubmitComposerDraft)
  let launcherInputStatus: "idle" | "pending" = "idle"
  if (isBusy) {
    launcherInputStatus = "pending"
  }
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
  const hasClipboardCandidateDraft =
    clipboardCandidateAttachments.length > 0 || clipboardCandidateContext.kind === "text"
  const hasAssistantSelectionRefs = assistantSelectionRefs.length > 0
  const hasLauncherSelectionContext = Boolean(selectionContext)
  const isComposerExpanded =
    !pendingApproval &&
    (query.includes("\n") ||
      hasAttachmentDraft ||
      hasClipboardCandidateDraft ||
      hasAssistantSelectionRefs ||
      hasLauncherSelectionContext)
  const shouldStackComposerControls = !pendingApproval && isComposerInputOverflowing
  const shellConfig = getAiShellConfig(surface.shellConfig)
  const isApprovalPending = Boolean(pendingApproval)
  const showFollowUpQueue = Boolean(
    !isApprovalPending && threadId && followUpQueue && followUpQueue.count > 0
  )
  const [commandSubmissionGate] = useState(createLauncherCommandSubmissionGate)
  const controller = useMemo(
    () =>
      createLauncherAiController({
        agentControl,
        branchThreadUntilMessage,
        commandSubmissionGate,
        createBranchThread,
        createThread,
        currentModelId,
        currentPermissionMode,
        defaultDraftPermissionMode,
        draftTarget,
        goToNextThread,
        goToPreviousThread,
        hasPendingCommand,
        hasPendingApproval,
        isBusy,
        onCommandAdmitted: handleCommandAdmitted,
        onCommandSettled: handleCommandSettled,
        onDidInvoke: handleAcceptedComposerInput,
        setNavigationError,
        setLocalComposerText: setComposerText,
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
      commandSubmissionGate,
      copy.launcher.aiThreadTitle,
      createBranchThread,
      createThread,
      currentModelId,
      currentPermissionMode,
      defaultDraftPermissionMode,
      draftTarget,
      goToNextThread,
      goToPreviousThread,
      handleCommandAdmitted,
      handleCommandSettled,
      handleAcceptedComposerInput,
      hasPendingCommand,
      hasPendingApproval,
      isBusy,
      setComposerText,
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
  const handleAcceptClipboardAttachments = useCallback((): void => {
    acceptClipboardAttachments()
    markComposerChanged()
  }, [acceptClipboardAttachments, markComposerChanged])
  const handleAddSelectedFiles = useCallback(
    async (files: FileList | File[]): Promise<void> => {
      markComposerChanged()
      await addSelectedFiles(files)
    },
    [addSelectedFiles, markComposerChanged]
  )
  const handleRemoveAttachment = useCallback(
    (attachmentId: string): void => {
      removeAttachment(attachmentId)
      markComposerChanged()
    },
    [markComposerChanged, removeAttachment]
  )
  const handleAddSelectionRef = useCallback(
    (ref: Parameters<typeof addSelectionRef>[0]): void => {
      addSelectionRef(ref)
      markComposerChanged()
    },
    [addSelectionRef, markComposerChanged]
  )
  const handleRemoveSelectionRef = useCallback(
    (ref: Parameters<typeof removeSelectionRef>[0]): void => {
      removeSelectionRef(ref)
      markComposerChanged()
    },
    [markComposerChanged, removeSelectionRef]
  )
  const handleClearSelectionRefs = useCallback((): void => {
    clearSelectionRefs()
    markComposerChanged()
  }, [clearSelectionRefs, markComposerChanged])
  const canGoToNextChat = canGoToNextThread
  const canGoToPreviousChat = canGoToPreviousThread
  const openAttachmentPicker = useCallback((): void => {
    fileInputRef.current?.click()
  }, [])
  const acceptClipboardText = useCallback((): void => {
    if (clipboardCandidateContext.kind !== "text") {
      return
    }

    const nextQuery =
      query.length > 0
        ? `${query}${query.endsWith("\n") ? "" : "\n"}${clipboardCandidateContext.text}`
        : clipboardCandidateContext.text
    clearClipboardContext()
    setQuery(nextQuery)
    focusComposerOnNextFrame()
  }, [clearClipboardContext, clipboardCandidateContext, focusComposerOnNextFrame, query, setQuery])
  const dismissClipboardCandidate = useCallback((): void => {
    clearClipboardContext()
  }, [clearClipboardContext])
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
    if (pendingCommandForCurrentThread) {
      await stopAgentThread(pendingCommandForCurrentThread.threadId)
      return
    }
    await stop()
  }, [pendingCommandForCurrentThread, stop])
  const handleOpenModelPicker = useCallback(async (): Promise<void> => {
    setShowModelPicker(true)
  }, [])
  const submitCurrentInput = useCallback((): void => {
    const input = getCurrentMessageInput()
    composerRevision.register(input)
    runPrimaryAction(input)
  }, [composerRevision, getCurrentMessageInput, runPrimaryAction])
  const dismissSelectionContext = useCallback((): void => {
    if (!selection || !selectionContext) {
      return
    }

    markComposerChanged()
    void selection.clearContext(selectionContext.id)
  }, [markComposerChanged, selection, selectionContext])
  const editQueuedFollowUp = useCallback(
    async (item: JingleAgentFollowUpQueueItem): Promise<void> => {
      if (!threadControl) {
        return
      }

      const edited = await threadControl.agent.takeFollowUp(item.requestId)
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
    async (item: JingleAgentFollowUpQueueItem): Promise<void> => {
      if (!threadControl) {
        return
      }

      await threadControl.agent.removeFollowUp(item.requestId)
    },
    [threadControl]
  )
  const steerQueuedFollowUp = useCallback(
    async (item: JingleAgentFollowUpQueueItem): Promise<void> => {
      if (!threadControl) {
        return
      }

      await threadControl.agent.steerFollowUp(
        item.requestId,
        activeRun ? { runId: activeRun.runId, turnId: activeRun.turnId } : undefined
      )
    },
    [activeRun, threadControl]
  )
  const getLatestPendingApprovalId = useLatestCallback(() => pendingApproval?.id ?? null)
  const submitApprovalDecision = useCallback(
    (decision: Parameters<typeof handleApprovalDecision>[0]): void => {
      const submittedApprovalId = pendingApproval?.id ?? null
      const submittedThreadId = threadId
      const submittedFeedback = approvalRejectFeedback
      const submittedFeedbackRevision = approvalFeedbackRevisionRef.current
      void handleApprovalDecision(decision).then((accepted) => {
        if (accepted && submittedApprovalId !== null && submittedThreadId !== null) {
          const submittedApprovalKey = getApprovalSubmissionKey(
            submittedThreadId,
            submittedApprovalId
          )
          setSettledApprovalKeys((currentKeys) => {
            if (currentKeys.has(submittedApprovalKey)) {
              return currentKeys
            }
            const nextKeys = new Set(currentKeys)
            nextKeys.add(submittedApprovalKey)
            return nextKeys
          })
        }
        const currentApprovalId = getLatestPendingApprovalId()
        if (
          (currentApprovalId !== null && currentApprovalId !== submittedApprovalId) ||
          approvalFeedbackRevisionRef.current !== submittedFeedbackRevision
        ) {
          return
        }
        if (!accepted && currentApprovalId !== null) {
          return
        }
        setApprovalRejectFeedback((currentFeedback) =>
          currentFeedback === submittedFeedback ? "" : currentFeedback
        )
      })
    },
    [
      approvalRejectFeedback,
      getLatestPendingApprovalId,
      handleApprovalDecision,
      pendingApproval?.id,
      threadId
    ]
  )
  const submitApprovalRejectFeedback = useCallback((): void => {
    if (!pendingApproval) {
      return
    }

    const feedback = approvalRejectFeedback.trim()
    submitApprovalDecision({
      type: "reject",
      ...(feedback ? { feedback } : {})
    })
  }, [approvalRejectFeedback, pendingApproval, submitApprovalDecision])
  const submitApprovalAccept = useCallback((): void => {
    if (!pendingApproval) {
      return
    }

    submitApprovalDecision({ type: "approve" })
  }, [pendingApproval, submitApprovalDecision])
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
    hasLauncherSelectionContext ||
    hasThreadMessages
  const canBranchThread = Boolean(threadId && hasThreadMessages && canForkThread)
  const canUseHeaderThreadActions = !isApprovalPending
  const canOpenSidebar = canUseHeaderThreadActions
  const canNavigateAcrossThreads = canUseHeaderThreadActions && !isPinnedThreadSurface
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
  const isSidebarPreviewVisible = canOpenSidebar && isSidebarPreviewOpen && !isSidebarOpen
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
  const trimmedThreadSearchQuery = threadSearch.query.trim()
  useEffect(() => {
    if (!threadSearch.isOpen || !trimmedThreadSearchQuery) {
      return
    }

    let cancelled = false
    const searchTimer = window.setTimeout(() => {
      dispatchThreadSearch({ type: "search-start" })
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

          dispatchThreadSearch({
            type: "search-success",
            results: response.results.filter(
              (result) => result.action.type === "open-history-thread"
            )
          })
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return
          }

          console.warn("[LauncherAiPage] Failed to search launcher AI chats:", error)
          dispatchThreadSearch({ type: "search-failure" })
        })
    }, 100)

    return () => {
      cancelled = true
      window.clearTimeout(searchTimer)
    }
  }, [threadSearch.isOpen, trimmedThreadSearchQuery])
  const handleThreadSearchQueryChange = useCallback((nextQuery: string): void => {
    dispatchThreadSearch({ type: "query", query: nextQuery })
  }, [])
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
    dispatchThreadSearch({ type: "open" })
    void loadThreads()
  }, [loadThreads])
  const closeThreadSearch = useCallback((): void => {
    dispatchThreadSearch({ type: "close" })
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
  const runSidebarThreadAction = useCallback(async (action: () => Promise<void>): Promise<void> => {
    try {
      setNavigationError(null)
      await action()
    } catch (error) {
      setNavigationError(toErrorMessage(error))
    }
  }, [])
  const addSidebarProjectFromPicker = useCallback(async (): Promise<void> => {
    await runSidebarThreadAction(addSidebarProject)
  }, [addSidebarProject, runSidebarThreadAction])
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
    [clearTransientInputState, focusComposerOnNextFrame, runSidebarThreadAction, startFreshDraft]
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
    canBranchThread: canNavigateAcrossThreads && canBranchThread,
    canGoToNextChat: canNavigateAcrossThreads && canGoToNextChat,
    canGoToPreviousChat: canNavigateAcrossThreads && canGoToPreviousChat,
    canStartNewQuestion: canNavigateAcrossThreads && canStartNewQuestion,
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
    if (autoOpenSidebarMinWidth === undefined) {
      return
    }

    const openSidebarWhenWide = (): void => {
      if (window.innerWidth >= autoOpenSidebarMinWidth) {
        setIsSidebarOpen(true)
      }
    }
    const frameId = window.requestAnimationFrame(openSidebarWhenWide)
    window.addEventListener("resize", openSidebarWhenWide)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener("resize", openSidebarWhenWide)
    }
  }, [autoOpenSidebarMinWidth])

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

  let conversationBranchHandler: typeof handleBranchChat | undefined
  let sidebarOpenDataAttribute: string | undefined
  const shouldShowExpandedSidebar = canOpenSidebar && isSidebarOpen

  if (canNavigateAcrossThreads) {
    conversationBranchHandler = handleBranchChat
  }

  if (shouldShowExpandedSidebar) {
    sidebarOpenDataAttribute = ""
  }

  return (
    <OpenTargetProvider folderPath={workspacePath}>
      <div className="relative h-full">
        <LauncherChrome
          headerLeading={
            <LauncherAiHeaderLeadingActions
              canGoToNextChat={canNavigateAcrossThreads && canGoToNextChat}
              canGoToPreviousChat={canNavigateAcrossThreads && canGoToPreviousChat}
              canOpenSidebar={canOpenSidebar}
              canStartNewQuestion={canNavigateAcrossThreads && canStartNewQuestion}
              isSidebarOpen={shouldShowExpandedSidebar}
              labels={{
                collapseSidebar: copy.launcher.collapseSidebar,
                expandSidebar: copy.launcher.expandSidebar,
                goHome: copy.launcher.goHome,
                goToNextChat: copy.launcher.goToNextChat,
                goToPreviousChat: copy.launcher.goToPreviousChat,
                newQuestion: copy.launcher.newQuestion
              }}
              showBackButton={showBackButton}
              showThreadNavigationActions={canNavigateAcrossThreads}
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
              canBranchThread={canNavigateAcrossThreads && canBranchThread}
              canOpenThreadMenu={canUseHeaderThreadActions}
              canOpenPinnedWindow={
                canUseHeaderThreadActions && !isPinnedThreadSurface && Boolean(threadId)
              }
              isPinned={isCurrentThreadPinned}
              environment={{
                modelLabel: currentModelLabel,
                permissionLabel: currentPermissionLabel,
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
              showOpenPinnedWindowAction={!isPinnedThreadSurface}
              onTogglePinned={() => {
                void toggleCurrentThreadPinned()
              }}
            />
          }
          hideInputChrome
          inputStatus={launcherInputStatus}
          inputValue={query}
          onInputValueChange={setQuery}
          placeholders={[
            copy.launcher.aiInputPlaceholder,
            copy.launcher.aiInputPlaceholderSecondary
          ]}
          shellConfig={shellConfig}
          surface={AI_LAUNCHER_PLUGIN_ID}
        >
          <div className="launcher-ai-body" data-sidebar-open={sidebarOpenDataAttribute}>
            {shouldShowExpandedSidebar ? (
              <LauncherAiSidebarPanel
                activeThreadId={threadId}
                canBranchThread={canNavigateAcrossThreads}
                canCreateChat={canNavigateAcrossThreads}
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
                canBranchThread={canNavigateAcrossThreads}
                canCreateChat={canNavigateAcrossThreads}
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
            <AssistantSelectionReferenceNavigationProvider>
              <div
                className="launcher-ai-main min-w-0 flex-1"
                data-launcher-ai-main=""
                data-launcher-ai-thread-id={threadId ?? undefined}
              >
                {threadId ? (
                  <LauncherAiConversation
                    clearError={clearVisibleError}
                    error={threadError}
                    isHydrating={isHydratingThread}
                    isLoading={isBusy}
                    loadingReason={threadLoadingReason}
                    onAddAssistantSelectionRef={handleAddSelectionRef}
                    onBranch={conversationBranchHandler}
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
                  className="launcher-ai-composer-footer shrink-0 px-[var(--launcher-ai-composer-page-x)] pb-[var(--jingle-space-2)]"
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
                          submitApprovalDecision(decision)
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
                      "mx-auto w-full max-w-[var(--launcher-ai-content-max-width)] px-[var(--jingle-space-2)] py-[var(--jingle-space-1)]",
                      (isApprovalPending || showFollowUpQueue) && "rounded-t-none border-t-0"
                    )}
                    style={{ backgroundColor: "var(--background-elevated)" }}
                    isLoading={isBusy}
                    maxHeight="var(--launcher-ai-composer-input-max-h)"
                    minHeight="var(--launcher-ai-composer-input-min-h)"
                    onSubmit={isApprovalPending ? undefined : submitCurrentInput}
                    onValueChange={isApprovalPending ? setApprovalFeedback : setQuery}
                    value={isApprovalPending ? approvalRejectFeedback : query}
                  >
                    <input
                      ref={fileInputRef}
                      aria-label={copy.launcher.aiAddAttachment}
                      type="file"
                      multiple
                      className="hidden"
                      accept={AI_ATTACHMENT_IMAGE_EXTENSIONS.map(
                        (extension) => `.${extension}`
                      ).join(",")}
                      onChange={(event) => {
                        if (event.target.files) {
                          void handleAddSelectedFiles(event.target.files)
                        }
                        event.target.value = ""
                      }}
                    />

                    <div
                      className={cn(
                        "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-x-[var(--jingle-gap-sm)] gap-y-[var(--jingle-space-1)]",
                        shouldStackComposerControls
                          ? "items-center"
                          : isComposerExpanded
                            ? "items-end"
                            : "items-center"
                      )}
                    >
                      {!isApprovalPending ? (
                        <div
                          className={cn(
                            "flex shrink-0 items-center",
                            shouldStackComposerControls
                              ? "col-start-1 row-start-2"
                              : "col-start-1 row-start-1"
                          )}
                        >
                          <PromptInputAction
                            onClick={openAttachmentPicker}
                            onMouseDown={(event) => event.preventDefault()}
                            icon={<Plus className="size-[var(--jingle-icon-xs)]" />}
                            label={copy.launcher.aiAddAttachment}
                            title={
                              addAttachmentShortcut
                                ? `${copy.launcher.aiAddAttachment} (${addAttachmentShortcut})`
                                : copy.launcher.aiAddAttachment
                            }
                            tooltip={copy.launcher.aiAddAttachment}
                          />
                        </div>
                      ) : null}

                      <div
                        className={cn(
                          "flex min-w-0 flex-1 flex-col gap-[var(--jingle-space-1)]",
                          shouldStackComposerControls
                            ? "col-span-3 col-start-1 row-start-1"
                            : isApprovalPending
                              ? "col-span-2 col-start-1 row-start-1"
                              : "col-start-2 row-start-1"
                        )}
                      >
                        <PromptInputTextarea
                          composerRef={inputRef as React.RefObject<ComposerAreaHandle | null>}
                          mode="composer"
                          onMentionQueryChange={setMentionQuery}
                          onVisualLineOverflowChange={setIsComposerInputOverflowing}
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
                          className="w-full py-[7px] [font-size:var(--jingle-font-control)] font-normal"
                        />

                        {!isApprovalPending ? (
                          <>
                            <ClipboardChip
                              context={
                                clipboardCandidateContext.kind === "text"
                                  ? clipboardCandidateContext
                                  : { kind: "none" }
                              }
                              onAccept={acceptClipboardText}
                              onClear={dismissClipboardCandidate}
                            />
                            <SelectionContextChip
                              context={selectionContext}
                              onClear={dismissSelectionContext}
                            />
                            <LauncherAttachmentStrip
                              attachments={clipboardCandidateAttachments}
                              intent="candidate"
                              onAccept={handleAcceptClipboardAttachments}
                              onRemove={dismissClipboardCandidate}
                              removeLabel={copy.launcher.clearClipboardContext}
                            />
                            <LauncherAttachmentStrip
                              attachments={attachments}
                              onRemove={handleRemoveAttachment}
                            />
                            <AssistantSelectionReferencePill
                              className="px-[var(--jingle-space-1)]"
                              refs={assistantSelectionRefs}
                              removable
                              onClear={handleClearSelectionRefs}
                              onRemove={handleRemoveSelectionRef}
                            />
                          </>
                        ) : null}
                      </div>

                      <div
                        className={cn(
                          "flex shrink-0 items-center gap-[var(--jingle-gap-sm)]",
                          shouldStackComposerControls
                            ? "col-start-3 row-start-2 justify-self-end"
                            : "col-start-3 row-start-1"
                        )}
                      >
                        {isApprovalPending ? (
                          <>
                            <button
                              type="button"
                              className="min-h-8 rounded-full px-[var(--jingle-space-2-5)] [font-size:var(--jingle-font-body)] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              disabled={hasPendingCommand}
                              onClick={submitApprovalRejectFeedback}
                            >
                              {copy.toolCall.decline}
                            </button>
                            <button
                              type="button"
                              className="min-h-8 rounded-full bg-foreground px-[var(--jingle-space-3)] [font-size:var(--jingle-font-body)] font-semibold text-background shadow-[0_6px_16px_rgba(32,38,45,0.14)] transition-transform hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
                              disabled={hasPendingCommand}
                              onClick={submitApprovalAccept}
                            >
                              {copy.toolCall.accept}
                            </button>
                            {hasPendingCurrentCommand ? (
                              <PromptInputAction
                                onClick={() => {
                                  void handleStop()
                                }}
                                onMouseDown={(event) => event.preventDefault()}
                                icon={<Square className="size-[var(--jingle-icon-compact)]" />}
                                label={copy.launcher.aiStopLabel}
                                title={copy.launcher.aiStopLabel}
                                tooltip={copy.launcher.aiStopLabel}
                              />
                            ) : null}
                          </>
                        ) : null}

                        {actionController.canOpenActions && !isApprovalPending ? (
                          <PromptInputAction
                            onClick={() => actionController.openActions()}
                            onMouseDown={(event) => event.preventDefault()}
                            icon={<Command className="size-[var(--jingle-icon-sm)]" />}
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
                            icon={<Square className="size-[var(--jingle-icon-compact)]" />}
                            label={copy.launcher.aiStopLabel}
                            title={copy.launcher.aiStopLabel}
                            tooltip={copy.launcher.aiStopLabel}
                          />
                        ) : !isApprovalPending ? (
                          <PromptInputAction
                            onClick={submitCurrentInput}
                            onMouseDown={(event) => event.preventDefault()}
                            disabled={primaryActionDisabled}
                            icon={<ArrowUp className="size-[var(--jingle-icon-sm)]" />}
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
            </AssistantSelectionReferenceNavigationProvider>
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

        {threadSearch.isOpen ? (
          <LauncherAiThreadSearchOverlay
            activeIndex={threadSearch.activeIndex}
            currentThreadId={threadId}
            isLoading={threadSearch.isLoading}
            labels={{
              search: copy.launcher.sidebarSearch,
              searchLoading: copy.launcher.sidebarSearchLoading,
              searchNoResults: copy.launcher.sidebarSearchNoResults
            }}
            onActiveIndexChange={(activeIndex) => {
              dispatchThreadSearch({ type: "active-index", activeIndex })
            }}
            onClose={closeThreadSearch}
            onQueryChange={handleThreadSearchQueryChange}
            onSelectThread={(nextThreadId) => {
              void handleSelectThreadSearchResult(nextThreadId)
            }}
            query={threadSearch.query}
            results={threadSearch.results}
          />
        ) : null}
      </div>
    </OpenTargetProvider>
  )
}
