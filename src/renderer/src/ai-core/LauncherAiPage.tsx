import { ArrowLeft, GitBranch, Plus } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { LauncherActionOverlay } from "@/features/launcher-actions/LauncherActionOverlay"
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
    canGoToNextChat,
    canGoToPreviousChat,
    currentModelId,
    goToNextChat,
    goToPreviousChat,
    primaryActionDisabled,
    query,
    retry,
    runPrimaryAction,
    selectModel,
    setQuery,
    startNewThread,
    branchThread,
    threadId
  } = useAiThread({
    messageRefs: attachmentDraft.messageRefs,
    onDidInvoke: attachmentDraft.clearAllAttachments
  })
  const { inputRef, setInputStatus } = surface
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showModelPicker, setShowModelPicker] = useState(false)
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
  const handleOpenModelPicker = useCallback(async (): Promise<void> => {
    setShowModelPicker(true)
  }, [])
  const canStartNewQuestion =
    query.trim().length > 0 ||
    attachmentDraft.attachments.length > 0 ||
    conversation.displayMessages.length > 0
  const { actionController, addAttachmentShortcut, submitShortcut } = useLauncherAiActions({
    branchThread: handleBranchChat,
    canBranchThread: Boolean(threadId && conversation.displayMessages.length > 0 && !isBusy),
    canGoToNextChat,
    canGoToPreviousChat,
    canStartNewQuestion,
    copy: copy.launcher,
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
    isBusy,
    navigateHome: navigation.goHome,
    newQuestion: handleNewQuestion,
    openAttachmentPicker,
    openModelPicker: handleOpenModelPicker,
    query,
    runPrimaryAction
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
            <div className="flex min-w-0 items-center gap-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {copy.launcher.aiFooterLeading}
              </div>
              {branchFeedbackUntil !== null ? (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-foreground/6 px-2.5 py-1 text-[11px] font-medium text-foreground">
                  <GitBranch className="size-3" />
                  <span>{copy.launcher.branchChatSwitched}</span>
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {actionController.canOpenActions ? (
                <button
                  type="button"
                  onClick={actionController.openActions}
                  onMouseDown={(event) => event.preventDefault()}
                  className="launcher-action-link flex h-7 appearance-none items-center gap-2 rounded-[9px] border-0 px-2.5 text-[12px] font-medium text-foreground"
                >
                  <span>{copy.launcher.actionsLabel}</span>
                  {actionController.actionPanelShortcut ? (
                    <span className="launcher-shortcut text-[11px] text-muted-foreground">
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
                className="launcher-action-link flex h-7 appearance-none items-center gap-2 rounded-[9px] border-0 px-2.5 text-[12px] font-medium text-foreground disabled:cursor-default disabled:opacity-45"
              >
                <span>{copy.launcher.aiPrimaryLabel}</span>
                {submitShortcut ? (
                  <span className="launcher-shortcut text-[11px] text-muted-foreground">
                    {submitShortcut}
                  </span>
                ) : null}
              </button>
            </div>
          </>
        }
        headerLeading={
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={navigation.goHome}
              onMouseDown={(event) => event.preventDefault()}
              aria-label={copy.launcher.goHome}
              title={copy.launcher.goHome}
              className="launcher-icon-button flex h-7 w-7 shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
            </button>

            <div className="flex min-w-0 items-center gap-1">
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
                className="launcher-icon-button flex h-5.5 w-5.5 shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
              >
                <Plus className="size-2.5" />
              </button>

              <LauncherAttachmentStrip
                attachments={attachmentDraft.attachments}
                onRemove={attachmentDraft.removeAttachment}
              />
            </div>
          </div>
        }
        inputStatus={inputStatus}
        inputRef={inputRef}
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
            pendingApproval={conversation.pendingApproval}
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
