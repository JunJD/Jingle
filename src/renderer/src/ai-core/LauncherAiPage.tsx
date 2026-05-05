import { ArrowLeft, ChevronDown, GitBranch, Plus, ShieldCheck, Square } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { LauncherActionOverlay } from "@/features/launcher-actions/LauncherActionOverlay"
import { ComposerApprovalPrompt } from "@/components/chat/ComposerApprovalPrompt"
import { getToolApprovalPresentationMeta } from "@/components/chat/tools/tool-approval-presentation"
import { useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import { AI_LAUNCHER_PLUGIN_ID } from "@shared/launcher-ai"
import { AI_ATTACHMENT_FILE_EXTENSIONS } from "@shared/launcher-attachments"
import { LauncherChrome } from "@launcher-components/LauncherChrome"
import { LauncherAiConversation, LauncherAiEmptyState } from "./LauncherAiConversation"
import { LauncherAiModelPicker } from "./LauncherAiModelPicker"
import { useAiCoreNavigation, useAiCoreSurface } from "./AiCoreHost"
import { LauncherAttachmentStrip } from "./LauncherAttachmentStrip"
import { useAiAttachments } from "./useAiAttachments"
import { useAiThread } from "./useAiThread"
import { useLauncherAiActions } from "./useLauncherAiActions"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useDisableTabNavigation } from "@/lib/use-disable-tab-navigation"

const AI_SHORTCUT_SCOPES = ["launcher.ai"] as const

export function LauncherAiPage(): React.JSX.Element {
  const { copy } = useI18n()
  const attachmentDraft = useAiAttachments()
  const navigation = useAiCoreNavigation()
  const surface = useAiCoreSurface()
  const [branchFeedbackUntil, setBranchFeedbackUntil] = useState<number | null>(null)
  const {
    conversation,
    handleApprovalDecision,
    inputStatus,
    isBusy,
    canStop,
    canGoToNextChat,
    canGoToPreviousChat,
    currentModelId,
    currentPermissionMode,
    goToNextChat,
    goToPreviousChat,
    primaryActionDisabled,
    query,
    retry,
    runPrimaryAction,
    selectModel,
    selectPermissionMode,
    setQuery,
    startNewThread,
    stop,
    branchThread,
    threadId
  } = useAiThread({
    messageRefs: attachmentDraft.messageRefs,
    onDidInvoke: attachmentDraft.clearAllAttachments
  })
  const { inputRef, setInputStatus } = surface
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const pendingApproval = conversation.pendingApproval
  const isApprovalPending = Boolean(pendingApproval)
  const pendingApprovalMeta = pendingApproval
    ? getToolApprovalPresentationMeta(copy, pendingApproval.review, pendingApproval.tool_call.name)
    : null
  const openAttachmentPicker = useCallback((): void => {
    fileInputRef.current?.click()
  }, [])
  const handleNewQuestion = useCallback(async (): Promise<void> => {
    const nextThreadId = await startNewThread()
    if (!nextThreadId) {
      return
    }

    attachmentDraft.clearAllAttachments()
    setShowModelPicker(false)
  }, [attachmentDraft, startNewThread])
  const handleBranchChat = useCallback(async (): Promise<void> => {
    const nextThreadId = await branchThread()
    if (!nextThreadId) {
      return
    }

    attachmentDraft.clearAllAttachments()
    setShowModelPicker(false)
    setBranchFeedbackUntil(Date.now() + 1800)
  }, [attachmentDraft, branchThread])
  const handleStop = useCallback(async (): Promise<void> => {
    await stop()
  }, [stop])
  const handleOpenModelPicker = useCallback(async (): Promise<void> => {
    setShowModelPicker(true)
  }, [])
  const canStartNewQuestion =
    query.trim().length > 0 ||
    attachmentDraft.attachments.length > 0 ||
    conversation.displayMessages.length > 0
  const { actionController, addAttachmentShortcut, permissionModeLabel, submitShortcut } =
    useLauncherAiActions({
      branchThread: handleBranchChat,
      canBranchThread: Boolean(threadId && conversation.displayMessages.length > 0 && !isBusy),
      canGoToNextChat,
      canGoToPreviousChat,
      canStartNewQuestion,
      copy: copy.launcher,
      currentPermissionMode,
      goToNextChat: async () => {
        const nextThreadId = await goToNextChat()
        if (!nextThreadId) {
          return
        }

        attachmentDraft.clearAllAttachments()
        setShowModelPicker(false)
      },
      goToPreviousChat: async () => {
        const previousThreadId = await goToPreviousChat()
        if (!previousThreadId) {
          return
        }

        attachmentDraft.clearAllAttachments()
        setShowModelPicker(false)
      },
      inputRef,
      isApprovalPending,
      isBusy,
      navigateHome: navigation.goHome,
      newQuestion: handleNewQuestion,
      openAttachmentPicker,
      openModelPicker: handleOpenModelPicker,
      query,
      runPrimaryAction,
      selectPermissionMode
    })

  useShortcutScopeLayer(AI_SHORTCUT_SCOPES)
  useDisableTabNavigation(inputRef)

  useEffect(() => {
    setInputStatus(inputStatus)

    return () => {
      setInputStatus("idle")
    }
  }, [inputStatus, setInputStatus])

  useEffect(() => {
    if (branchFeedbackUntil === null) {
      return
    }

    const timeoutId = window.setTimeout(
      () => {
        setBranchFeedbackUntil((currentUntil) =>
          currentUntil === branchFeedbackUntil ? null : currentUntil
        )
      },
      Math.max(branchFeedbackUntil - Date.now(), 0)
    )

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [branchFeedbackUntil])

  return (
    <div className="relative h-full">
      <LauncherChrome
        footer={
          <>
            <div className="flex min-w-0 items-center gap-[var(--ow-gap-md)]">
              <div className="[font-size:var(--ow-font-meta)] uppercase tracking-[0.14em] text-muted-foreground">
                {copy.launcher.aiFooterLeading}
              </div>
              {branchFeedbackUntil !== null ? (
                <div className="inline-flex items-center gap-[var(--ow-space-1-5)] rounded-full bg-foreground/6 px-[var(--ow-space-2-5)] py-[var(--ow-space-1)] [font-size:var(--ow-font-meta)] font-medium text-foreground">
                  <GitBranch className="size-[var(--ow-icon-compact)]" />
                  <span>{copy.launcher.branchChatSwitched}</span>
                </div>
              ) : null}
              {isApprovalPending ? null : (
                <button
                  type="button"
                  onClick={actionController.openActions}
                  onMouseDown={(event) => event.preventDefault()}
                  className="launcher-action-link inline-flex h-[var(--launcher-action-control-h)] items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] px-[var(--ow-space-2-5)] [font-size:var(--ow-font-control)] font-medium text-foreground"
                >
                  <ShieldCheck className="size-[var(--ow-icon-compact)] text-status-warning" />
                  <span>{permissionModeLabel}</span>
                  <ChevronDown className="size-[var(--ow-icon-compact)] text-muted-foreground" />
                </button>
              )}
            </div>

            {isApprovalPending ? null : (
              <div className="flex items-center gap-[var(--ow-gap-sm)]">
                {actionController.canOpenActions ? (
                  <button
                    type="button"
                    onClick={actionController.openActions}
                    onMouseDown={(event) => event.preventDefault()}
                    className="launcher-action-link flex h-[var(--launcher-action-control-h)] appearance-none items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] border-0 px-[var(--ow-space-2-5)] [font-size:var(--ow-font-control)] font-medium text-foreground"
                  >
                    <span>{copy.launcher.actionsLabel}</span>
                    {actionController.actionPanelShortcut ? (
                      <span className="launcher-shortcut [font-size:var(--ow-font-meta)] text-muted-foreground">
                        {actionController.actionPanelShortcut}
                      </span>
                    ) : null}
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={runPrimaryAction}
                  onMouseDown={(event) => event.preventDefault()}
                  disabled={primaryActionDisabled}
                  className="launcher-action-link flex h-[var(--launcher-action-control-h)] appearance-none items-center gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] border-0 px-[var(--ow-space-2-5)] [font-size:var(--ow-font-control)] font-medium text-foreground disabled:cursor-default disabled:opacity-45"
                >
                  <span>{copy.launcher.aiPrimaryLabel}</span>
                  {submitShortcut ? (
                    <span className="launcher-shortcut [font-size:var(--ow-font-meta)] text-muted-foreground">
                      {submitShortcut}
                    </span>
                  ) : null}
                </button>
              </div>
            )}
          </>
        }
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

            <div className="flex min-w-0 items-center gap-[var(--ow-gap-xs)]">
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

              {isApprovalPending ? null : (
                <button
                  type="button"
                  onClick={openAttachmentPicker}
                  onMouseDown={(event) => event.preventDefault()}
                  aria-label={copy.launcher.aiAddAttachment}
                  title={
                    addAttachmentShortcut
                      ? `${copy.launcher.aiAddAttachment} (${addAttachmentShortcut})`
                      : copy.launcher.aiAddAttachment
                  }
                  className="launcher-icon-button flex h-[var(--launcher-inline-icon-button-size)] w-[var(--launcher-inline-icon-button-size)] shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
                >
                  <Plus className="size-[var(--ow-icon-xs)]" />
                </button>
              )}

              <LauncherAttachmentStrip
                attachments={attachmentDraft.attachments}
                onRemove={attachmentDraft.removeAttachment}
              />
            </div>
          </div>
        }
        inputTrailing={
          canStop ? (
            <button
              type="button"
              onClick={() => {
                void handleStop()
              }}
              onMouseDown={(event) => event.preventDefault()}
              aria-label={copy.launcher.aiStopLabel}
              title={copy.launcher.aiStopLabel}
              className="launcher-icon-button flex h-[var(--launcher-inline-icon-button-size)] w-[var(--launcher-inline-icon-button-size)] shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
            >
              <Square className="size-[var(--ow-icon-compact)]" />
            </button>
          ) : undefined
        }
        inputAccessory={
          pendingApproval ? (
            <div className="shrink-0 px-[var(--launcher-ai-content-x)] py-[var(--ow-space-3)]">
              <div className="mx-auto w-full max-w-[var(--launcher-ai-content-max-width)]">
                <ComposerApprovalPrompt
                  key={pendingApproval.id}
                  density="compact"
                  onDecision={(decision) => {
                    void handleApprovalDecision(decision)
                  }}
                  request={pendingApproval}
                />
              </div>
            </div>
          ) : undefined
        }
        inputReplacement={
          pendingApprovalMeta ? (
            <div
              className={cn(
                "flex h-[var(--ow-control-h-sm)] min-w-0 items-center gap-[var(--ow-gap-sm)] px-[var(--ow-space-1)]",
                "[font-size:var(--ow-font-control)] font-medium text-foreground"
              )}
            >
              <span className="shrink-0 text-muted-foreground/72">
                {copy.toolCall.approvalItem}
              </span>
              <span className="min-w-0 truncate">{pendingApprovalMeta.title}</span>
              {pendingApprovalMeta.subtitle ? (
                <span className="min-w-0 truncate text-muted-foreground/64">
                  {pendingApprovalMeta.subtitle}
                </span>
              ) : null}
            </div>
          ) : undefined
        }
        inputStatus={inputStatus}
        inputRef={inputRef}
        showInputStatusIndicator={false}
        density="compact"
        inputValue={query}
        onInputValueChange={setQuery}
        placeholders={[copy.launcher.aiInputPlaceholder, copy.launcher.aiInputPlaceholderSecondary]}
        shellConfig={surface.shellConfig}
        surface={AI_LAUNCHER_PLUGIN_ID}
      >
        {threadId ? (
          <LauncherAiConversation
            clearError={conversation.clearVisibleError}
            displayMessages={conversation.displayMessages}
            error={conversation.visibleError}
            isLoading={conversation.isLoading}
            onApprovalDecision={handleApprovalDecision}
            onRetry={retry}
            pendingApproval={pendingApproval}
            todos={conversation.todos}
          />
        ) : (
          <LauncherAiEmptyState error={conversation.visibleError} />
        )}
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
    </div>
  )
}
