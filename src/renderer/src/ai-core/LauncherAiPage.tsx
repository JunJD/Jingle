import { ArrowLeft, ArrowUp, Plus, Square } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { LauncherActionOverlay } from "@/features/launcher-actions/LauncherActionOverlay"
import { ComposerApprovalPrompt } from "@/components/chat/ComposerApprovalPrompt"
import { getToolApprovalPresentationMeta } from "@/components/chat/tools/tool-approval-presentation"
import { useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import { formatShortcutChord } from "@/shortcuts/format-shortcut"
import { AI_LAUNCHER_PLUGIN_ID } from "@shared/launcher-ai"
import { AI_ATTACHMENT_FILE_EXTENSIONS } from "@shared/launcher-attachments"
import { resolveShortcutPlatform } from "@shared/shortcuts/model"
import { LauncherChrome } from "@launcher-components/LauncherChrome"
import { LauncherInput } from "@launcher-components/LauncherInput"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import { getAiShellConfig } from "./ai-config"
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

function insertTextAtSelection(input: LauncherInputElement, text: string): string {
  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? start
  const nextValue = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`
  const nextSelection = start + text.length

  window.requestAnimationFrame(() => {
    input.setSelectionRange(nextSelection, nextSelection)
  })

  return nextValue
}

export function LauncherAiPage(): React.JSX.Element {
  const { copy } = useI18n()
  const attachmentDraft = useAiAttachments()
  const navigation = useAiCoreNavigation()
  const surface = useAiCoreSurface()
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
  const hasConversationContent =
    conversation.displayMessages.length > 0 ||
    conversation.isLoading ||
    Boolean(conversation.visibleError)
  const isComposerExpanded =
    !pendingApproval &&
    (query.includes("\n") ||
      attachmentDraft.attachments.length > 0 ||
      (!hasConversationContent && !isBusy))
  const shellConfig = getAiShellConfig(surface.shellConfig, {
    footerExpanded: isComposerExpanded
  })
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
  }, [attachmentDraft, branchThread])
  const handleStop = useCallback(async (): Promise<void> => {
    await stop()
  }, [stop])
  const handleOpenModelPicker = useCallback(async (): Promise<void> => {
    setShowModelPicker(true)
  }, [])
  const insertLineBreak = useCallback((): void => {
    const input = inputRef.current
    if (!input) {
      setQuery(`${query}\n`)
      return
    }

    setQuery(insertTextAtSelection(input, "\n"))
  }, [inputRef, query, setQuery])
  const handleComposerKeyDown = useCallback(
    (event: React.KeyboardEvent<LauncherInputElement>): void => {
      if (event.key !== "Enter") {
        return
      }

      if (event.shiftKey || event.ctrlKey) {
        event.preventDefault()
        insertLineBreak()
        return
      }

      if (event.metaKey || event.altKey) {
        return
      }

      event.preventDefault()
      runPrimaryAction()
    },
    [insertLineBreak, runPrimaryAction]
  )
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
    insertLineBreak,
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
    setInputStatus(inputStatus)

    return () => {
      setInputStatus("idle")
    }
  }, [inputStatus, setInputStatus])

  return (
    <div className="relative h-full">
      <LauncherChrome
        footer={
          pendingApproval || pendingApprovalMeta ? undefined : (
            <div
              className={cn(
                "launcher-ai-composer-wrap flex h-full w-full shrink-0 items-center px-[var(--launcher-ai-composer-page-x)]",
                isComposerExpanded ? "py-[var(--ow-space-2)]" : "py-[var(--ow-space-1-5)]"
              )}
            >
              <div
                className={cn(
                  "launcher-ai-composer mx-auto flex w-full max-w-[var(--launcher-ai-content-max-width)] flex-col overflow-hidden",
                  isComposerExpanded && "launcher-ai-composer--expanded"
                )}
              >
                <div className="flex min-w-0 items-start gap-[var(--ow-gap-sm)] px-[var(--launcher-ai-composer-x)] py-[var(--launcher-ai-composer-y)]">
                  <div className="flex min-w-0 flex-1 flex-col gap-[var(--ow-space-1)]">
                    <div className="flex min-w-0 items-center gap-[var(--ow-gap-sm)]">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        accept={AI_ATTACHMENT_FILE_EXTENSIONS.map(
                          (extension) => `.${extension}`
                        ).join(",")}
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
                        className="launcher-icon-button launcher-ai-composer-attachment flex h-[var(--launcher-inline-icon-button-size)] w-[var(--launcher-inline-icon-button-size)] shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
                      >
                        <Plus className="size-[var(--ow-icon-xs)]" />
                      </button>

                      <LauncherInput
                        ref={inputRef}
                        density="compact"
                        expanded={isComposerExpanded}
                        multiline
                        trailing={undefined}
                        showStatusIndicator={false}
                        status={inputStatus}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={handleComposerKeyDown}
                        placeholders={[
                          copy.launcher.aiInputPlaceholder,
                          copy.launcher.aiInputPlaceholderSecondary
                        ]}
                        className="[font-size:var(--ow-font-control)] font-medium text-foreground"
                        placeholderClassName="[font-size:var(--ow-font-control)] font-medium text-muted-foreground/54"
                      />
                    </div>

                    <LauncherAttachmentStrip
                      attachments={attachmentDraft.attachments}
                      onRemove={attachmentDraft.removeAttachment}
                    />
                  </div>

                  {canStop ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handleStop()
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      aria-label={copy.launcher.aiStopLabel}
                      title={copy.launcher.aiStopLabel}
                      className="launcher-icon-button launcher-ai-composer-submit flex h-[var(--launcher-ai-composer-submit-size)] w-[var(--launcher-ai-composer-submit-size)] shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
                    >
                      <Square className="size-[var(--ow-icon-compact)]" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={runPrimaryAction}
                      onMouseDown={(event) => event.preventDefault()}
                      disabled={primaryActionDisabled}
                      aria-label={copy.launcher.aiPrimaryLabel}
                      title={`${copy.launcher.aiPrimaryLabel} (${submitShortcutLabel})`}
                      className="launcher-icon-button launcher-ai-composer-submit flex h-[var(--launcher-ai-composer-submit-size)] w-[var(--launcher-ai-composer-submit-size)] shrink-0 appearance-none items-center justify-center rounded-full border-0 text-foreground transition hover:text-foreground disabled:cursor-default disabled:opacity-45"
                    >
                      <ArrowUp className="size-[var(--ow-icon-sm)]" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        }
        footerVariant="composer"
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

            <div className="min-w-0">
              <div className="truncate [font-size:var(--ow-font-control)] font-medium leading-[var(--ow-line-control-sm)] text-foreground">
                {copy.launcher.newQuestion}
              </div>
              <div className="truncate [font-size:var(--ow-font-meta)] leading-[var(--ow-line-tight)] text-muted-foreground">
                {currentModelId ?? copy.launcher.aiThreadTitle}
              </div>
            </div>
          </div>
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
        hideInputChrome={!pendingApprovalMeta}
        density="compact"
        inputValue={query}
        onInputValueChange={setQuery}
        placeholders={[copy.launcher.aiInputPlaceholder, copy.launcher.aiInputPlaceholderSecondary]}
        shellConfig={shellConfig}
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
