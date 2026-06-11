import { ArrowLeft, ArrowUp, Command, Plus, Square } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PromptInput, PromptInputAction, PromptInputTextarea } from "@/components/agent-ui"
import { LauncherActionOverlay } from "@/features/launcher-actions/LauncherActionOverlay"
import { ComposerApprovalPrompt } from "@/components/chat/ComposerApprovalPrompt"
import { useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import { formatShortcutChord } from "@/shortcuts/format-shortcut"
import { AI_LAUNCHER_PLUGIN_ID } from "@shared/launcher-ai"
import { AI_ATTACHMENT_FILE_EXTENSIONS } from "@shared/launcher-attachments"
import { resolveShortcutPlatform } from "@shared/shortcuts/model"
import { LauncherChrome } from "@launcher-components/LauncherChrome"
import { AI_MAX_FOOTER_HEIGHT, getAiShellConfig } from "./ai-config"
import { LauncherAiConversation, LauncherAiEmptyState } from "./LauncherAiConversation"
import { LauncherAiHeaderActions } from "./LauncherAiHeaderActions"
import { LauncherAiHeaderModelPicker } from "./LauncherAiHeaderModelPicker"
import { LauncherAiModelPicker } from "./LauncherAiModelPicker"
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
import { useThreadContext, useThreadSelector } from "@/lib/thread-context"
import { updateAgentThreadModel, updateAgentThreadPermissionMode } from "@/lib/agent-control"
import { useDisableTabNavigation } from "@/lib/use-disable-tab-navigation"
import { listNativeExtensionSourceMentions } from "@extensions/source-mentions"
import { useWorkspaceFileMentions, type ComposerAreaHandle } from "@/composer-area"
import { hasComposerMessageInputContent, type ComposerMessageInput } from "@shared/message-content"
import { shouldGoHomeFromComposerKeyDown } from "./composer-keyboard"

const AI_SHORTCUT_SCOPES = ["launcher.ai"] as const
const AI_COMPOSER_CHROME_HEIGHT = 30
const AI_COMPOSER_LINE_HEIGHT = 20
const AI_COMPOSER_VISIBLE_LINES = 5
const AI_ATTACHMENT_STRIP_HEIGHT = 48
const AI_COMPOSER_BOTTOM_GAP = 8
const DEFAULT_AGENT_CAN_FORK = true

function getVisibleLineCount(value: string): number {
  return Math.min(AI_COMPOSER_VISIBLE_LINES, value.split("\n").length)
}

export function LauncherAiPage(): React.JSX.Element {
  const { copy, locale } = useI18n()
  const sourceMentions = useMemo(
    () => listNativeExtensionSourceMentions(window.electron.process.platform, locale),
    [locale]
  )
  const attachmentDraft = useAiAttachments()
  const host = useAiCoreHost()
  const navigation = host.navigation
  const surface = host.surface
  const [initialSeedQuery] = useState(host.seedQuery)
  const hasRunInitialActionRef = useRef(false)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const [localComposerText, setLocalComposerText] = useState(() => initialSeedQuery)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
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
    startFreshDraft: startFreshDraftTarget,
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
  const updateThread = useHistoryShellStore((state) => state.updateThread)
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
  const currentModelId =
    useThreadSelector(threadId, (state) => state?.agent.currentModel ?? null) ??
    draftTarget?.modelId ??
    null
  const currentPermissionMode =
    useThreadSelector(threadId, (state) => state?.agent.permissionMode ?? null) ??
    draftTarget?.permissionMode ??
    defaultDraftPermissionMode
  const workspacePath = useThreadSelector(threadId, (state) => state?.agent.workspacePath ?? null)
  const query = localComposerText
  const messageInput = useMemo(
    () => ({
      refs: [...attachmentDraft.messageRefs, ...assistantSelectionRefs],
      text: query
    }),
    [assistantSelectionRefs, attachmentDraft.messageRefs, query]
  )
  const initialMessageInput = useMemo(
    () => ({
      refs: [...attachmentDraft.messageRefs],
      text: initialSeedQuery
    }),
    [attachmentDraft.messageRefs, initialSeedQuery]
  )
  const clearTransientInputState = useCallback((): void => {
    attachmentDraft.clearAllAttachments()
    clearSelectionRefs()
  }, [attachmentDraft.clearAllAttachments, clearSelectionRefs])
  const hasPendingApproval = Boolean(pendingApproval)
  const threadError = agentError ?? navigationError
  const primaryActionDisabled =
    isBusy || hasPendingApproval || !hasComposerMessageInputContent(messageInput)
  const composerOverlayRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [measuredComposerOverlayHeight, setMeasuredComposerOverlayHeight] = useState<number | null>(
    null
  )
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
  const canForkThread = useThreadSelector(
    threadId,
    (state) => state?.agent.forkState.canFork ?? DEFAULT_AGENT_CAN_FORK
  )
  const hasAttachmentDraft = attachmentDraft.attachments.length > 0
  const hasAssistantSelectionRefs = assistantSelectionRefs.length > 0
  const isComposerExpanded =
    !pendingApproval && (query.includes("\n") || hasAttachmentDraft || hasAssistantSelectionRefs)
  const composerTextHeight = 14 + getVisibleLineCount(query) * AI_COMPOSER_LINE_HEIGHT
  const estimatedComposerOverlayHeight = pendingApproval
    ? 0
    : Math.min(
        AI_MAX_FOOTER_HEIGHT,
        Math.ceil(
          composerTextHeight +
            AI_COMPOSER_CHROME_HEIGHT +
            (hasAttachmentDraft ? AI_ATTACHMENT_STRIP_HEIGHT : 0) +
            (hasAssistantSelectionRefs ? AI_ATTACHMENT_STRIP_HEIGHT : 0)
        )
      )
  const composerOverlayHeight = pendingApproval
    ? 0
    : (measuredComposerOverlayHeight ?? estimatedComposerOverlayHeight)
  const shellConfig = getAiShellConfig(surface.shellConfig)
  const conversationBottomInset =
    pendingApproval || composerOverlayHeight === 0
      ? 0
      : composerOverlayHeight + AI_COMPOSER_BOTTOM_GAP
  const isApprovalPending = Boolean(pendingApproval)
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
        refs: [...input.getRefs(), ...attachmentDraft.messageRefs, ...assistantSelectionRefs],
        text: input.getModelText()
      }
    }

    return {
      refs: [...attachmentDraft.messageRefs, ...assistantSelectionRefs],
      text: query
    }
  }, [assistantSelectionRefs, attachmentDraft.messageRefs, inputRef, query])
  const submitCurrentInput = useCallback((): void => {
    runPrimaryAction(getCurrentMessageInput())
  }, [getCurrentMessageInput, runPrimaryAction])
  const handleComposerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>): void => {
      const input = inputRef.current
      const composerText = input && "getModelText" in input ? input.getModelText() : query

      if (
        shouldGoHomeFromComposerKeyDown({
          attachmentCount: attachmentDraft.attachments.length,
          composerText,
          event
        })
      ) {
        event.preventDefault()
        navigation.goHome()
        return
      }
    },
    [attachmentDraft.attachments.length, inputRef, navigation, query]
  )
  const canStartNewQuestion =
    query.trim().length > 0 ||
    attachmentDraft.attachments.length > 0 ||
    assistantSelectionRefs.length > 0 ||
    hasThreadMessages
  const canBranchThread = Boolean(threadId && hasThreadMessages && canForkThread)
  const canUseHeaderThreadActions = !isApprovalPending
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
    if (threadId) {
      await window.api.mainWindow.openThread(threadId)
    } else {
      await window.api.mainWindow.openWindow()
    }
    await window.api.launcher.hide()
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

  useEffect(() => {
    const element = composerOverlayRef.current
    if (!element || typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(([entry]) => {
      const nextHeight = Math.min(AI_MAX_FOOTER_HEIGHT, Math.ceil(entry.contentRect.height))
      setMeasuredComposerOverlayHeight((current) => (current === nextHeight ? current : nextHeight))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [pendingApproval])

  return (
    <div className="relative h-full">
      <LauncherChrome
        headerLeading={
          <div className="flex min-w-0 items-center gap-[var(--ow-gap-sm)]">
            <button
              type="button"
              onClick={navigation.goHome}
              onMouseDown={(event) => event.preventDefault()}
              aria-label={copy.launcher.goHome}
              title={copy.launcher.goHome}
              className="launcher-icon-button flex h-[var(--launcher-icon-button-size)] w-[var(--launcher-icon-button-size)] shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="size-[var(--ow-icon-sm)]" />
            </button>

            <div className="flex min-w-0 flex-col items-start">
              <div className="truncate [font-size:var(--ow-font-control)] font-medium leading-[var(--ow-line-control-sm)] text-foreground">
                {currentThreadTitle?.trim() || copy.launcher.newQuestion}
              </div>
              <LauncherAiHeaderModelPicker
                currentModelId={currentModelId}
                fallbackLabel={copy.launcher.aiThreadTitle}
                onSelectModel={selectModel}
              />
            </div>
          </div>
        }
        headerTrailing={
          <LauncherAiHeaderActions
            canBranchThread={canUseHeaderThreadActions && canBranchThread}
            canGoToNextChat={canUseHeaderThreadActions && canGoToNextChat}
            canGoToPreviousChat={canUseHeaderThreadActions && canGoToPreviousChat}
            canOpenThreadMenu={canUseHeaderThreadActions}
            canStartNewQuestion={canUseHeaderThreadActions && canStartNewQuestion}
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
              goToNextChat: copy.launcher.goToNextChat,
              goToPreviousChat: copy.launcher.goToPreviousChat,
              newQuestion: copy.launcher.newQuestion,
              openSideChat: copy.launcher.openSideChat,
              pinChat: copy.launcher.pinChat,
              renameChat: copy.launcher.renameChat
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
            onGoToNextChat={() => {
              void handleGoToNextChat()
            }}
            onGoToPreviousChat={() => {
              void handleGoToPreviousChat()
            }}
            onNewQuestion={() => {
              void handleNewQuestion()
            }}
          />
        }
        inputAccessory={
          pendingApproval ? (
            <div className="shrink-0 px-[var(--launcher-ai-content-x)] py-[var(--ow-space-3)]">
              <div className="mx-auto w-full max-w-[var(--launcher-ai-content-max-width)]">
                <ComposerApprovalPrompt
                  key={pendingApproval.id}
                  onDecision={(decision) => {
                    void handleApprovalDecision(decision)
                  }}
                  request={pendingApproval}
                />
              </div>
            </div>
          ) : undefined
        }
        hideInputChrome
        inputValue={query}
        onInputValueChange={setQuery}
        placeholders={[copy.launcher.aiInputPlaceholder, copy.launcher.aiInputPlaceholderSecondary]}
        shellConfig={shellConfig}
        surface={AI_LAUNCHER_PLUGIN_ID}
      >
        {threadId ? (
          <LauncherAiConversation
            bottomInset={conversationBottomInset}
            clearError={clearVisibleError}
            error={threadError}
            isLoading={isBusy}
            onAddAssistantSelectionRef={addSelectionRef}
            onBranch={handleBranchChat}
            onRetry={runPrimaryAction}
            pendingApproval={pendingApproval}
            threadId={threadId}
          />
        ) : (
          <LauncherAiEmptyState bottomInset={conversationBottomInset} error={threadError} />
        )}
      </LauncherChrome>

      {!pendingApproval ? (
        <form
          ref={composerOverlayRef}
          className="pointer-events-none absolute inset-x-0 z-20 flex w-full flex-col justify-end px-[var(--launcher-ai-composer-page-x)]"
          onSubmit={(event) => {
            event.preventDefault()
            submitCurrentInput()
          }}
          style={{
            bottom: AI_COMPOSER_BOTTOM_GAP,
            maxHeight: AI_MAX_FOOTER_HEIGHT
          }}
        >
          <PromptInput
            className="pointer-events-auto mx-auto w-full max-w-[var(--launcher-ai-content-max-width)] px-[var(--ow-space-2)] py-[var(--ow-space-1)]"
            style={{ backgroundColor: "var(--background-elevated)" }}
            isLoading={isBusy}
            maxHeight="var(--launcher-ai-composer-input-max-h)"
            minHeight="var(--launcher-ai-composer-input-min-h)"
            onSubmit={submitCurrentInput}
            onValueChange={setQuery}
            value={query}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept={AI_ATTACHMENT_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(",")}
              onChange={(event) => {
                if (event.target.files) {
                  void attachmentDraft.addSelectedFiles(event.target.files)
                }
                event.target.value = ""
              }}
            />

            <div
              className={`flex min-w-0 gap-[var(--ow-gap-sm)] ${
                isComposerExpanded ? "items-end" : "items-center"
              }`}
            >
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

              <div className="flex min-w-0 flex-1 flex-col gap-[var(--ow-space-1)]">
                <PromptInputTextarea
                  composerRef={inputRef as React.RefObject<ComposerAreaHandle | null>}
                  mode="composer"
                  onMentionQueryChange={setMentionQuery}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={copy.launcher.aiInputPlaceholder}
                  sourceMentions={sourceMentions}
                  workspaceFileMentions={workspaceFileMentionState.files}
                  workspaceFileSearchEnabled={workspaceFileMentionState.searchEnabled}
                  workspaceFileSearchIncomplete={workspaceFileMentionState.isIncomplete}
                  workspaceFileSearchInProgress={workspaceFileMentionState.isSearching}
                  className="w-full py-[7px] [font-size:var(--ow-font-control)] font-normal"
                />

                <LauncherAttachmentStrip
                  attachments={attachmentDraft.attachments}
                  onRemove={attachmentDraft.removeAttachment}
                />
                <AssistantSelectionReferencePill
                  className="px-[var(--ow-space-1)]"
                  refs={assistantSelectionRefs}
                  removable
                  onClear={clearSelectionRefs}
                  onRemove={removeSelectionRef}
                />
              </div>

              <div className="flex shrink-0 items-center gap-[var(--ow-gap-sm)]">
                {actionController.canOpenActions ? (
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

                {canStop ? (
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
                ) : (
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
                )}
              </div>
            </div>
          </PromptInput>
        </form>
      ) : null}

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
    </div>
  )
}
