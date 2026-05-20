import { ArrowLeft, ArrowUp, Command, Plus, Square } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import {
  PromptInput,
  PromptInputAction,
  PromptInputTextarea,
  ThinkingBar
} from "@/components/agent-ui"
import { LauncherActionOverlay } from "@/features/launcher-actions/LauncherActionOverlay"
import { ComposerApprovalPrompt } from "@/components/chat/ComposerApprovalPrompt"
import { useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import { formatShortcutChord } from "@/shortcuts/format-shortcut"
import { AI_LAUNCHER_PLUGIN_ID } from "@shared/launcher-ai"
import { AI_ATTACHMENT_FILE_EXTENSIONS } from "@shared/launcher-attachments"
import { resolveShortcutPlatform } from "@shared/shortcuts/model"
import { LauncherChrome } from "@launcher-components/LauncherChrome"
import type { LauncherInputElement } from "@launcher-shell/input-element"
import { AI_FOOTER_HEIGHT, AI_MAX_FOOTER_HEIGHT, getAiShellConfig } from "./ai-config"
import { LauncherAiConversation, LauncherAiEmptyState } from "./LauncherAiConversation"
import { LauncherAiHeaderModelPicker } from "./LauncherAiHeaderModelPicker"
import { LauncherAiModelPicker } from "./LauncherAiModelPicker"
import { useAiCoreNavigation, useAiCoreSurface } from "./AiCoreHost"
import { LauncherAttachmentStrip } from "./LauncherAttachmentStrip"
import { useAiAttachments } from "./useAiAttachments"
import { useAiThread } from "./useAiThread"
import { useLauncherAiActions } from "./useLauncherAiActions"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useI18n } from "@/lib/i18n"
import { useDisableTabNavigation } from "@/lib/use-disable-tab-navigation"

const AI_SHORTCUT_SCOPES = ["launcher.ai"] as const
const AI_COMPOSER_CHROME_HEIGHT = 30
const AI_COMPOSER_LINE_HEIGHT = 20
const AI_COMPOSER_VISIBLE_LINES = 5
const AI_ATTACHMENT_STRIP_HEIGHT = 48
const AI_THINKING_STATUS_HEIGHT = 28

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

function getVisibleLineCount(value: string): number {
  return Math.min(AI_COMPOSER_VISIBLE_LINES, value.split("\n").length)
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
    startFreshDraft,
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
  const currentThreadTitle = useHistoryShellStore((state) => {
    if (!threadId) {
      return null
    }

    return state.threads.find((thread) => thread.thread_id === threadId)?.title ?? null
  })
  const pendingApproval = conversation.pendingApproval
  const hasAttachmentDraft = attachmentDraft.attachments.length > 0
  const isComposerExpanded = !pendingApproval && (query.includes("\n") || hasAttachmentDraft)
  const composerTextHeight = 14 + getVisibleLineCount(query) * AI_COMPOSER_LINE_HEIGHT
  const composerFooterHeight = pendingApproval
    ? AI_FOOTER_HEIGHT
    : Math.min(
        AI_MAX_FOOTER_HEIGHT,
        Math.max(
          AI_FOOTER_HEIGHT,
          Math.ceil(
            composerTextHeight +
              AI_COMPOSER_CHROME_HEIGHT +
              (conversation.isLoading ? AI_THINKING_STATUS_HEIGHT : 0) +
              (hasAttachmentDraft ? AI_ATTACHMENT_STRIP_HEIGHT : 0)
          )
        )
      )
  const shellConfig = getAiShellConfig(surface.shellConfig, {
    footerHeight: composerFooterHeight
  })
  const isApprovalPending = Boolean(pendingApproval)
  const openAttachmentPicker = useCallback((): void => {
    fileInputRef.current?.click()
  }, [])
  const handleNewQuestion = useCallback(async (): Promise<void> => {
    const didStart = await startFreshDraft()
    if (!didStart) {
      return
    }

    attachmentDraft.clearAllAttachments()
    setShowModelPicker(false)
  }, [attachmentDraft, startFreshDraft])
  const handleBranchChat = useCallback(
    async (messageId?: string): Promise<void> => {
      const nextThreadId = await branchThread(messageId)
      if (!nextThreadId) {
        return
      }

      attachmentDraft.clearAllAttachments()
      setShowModelPicker(false)
    },
    [attachmentDraft, branchThread]
  )
  const handleStop = useCallback(async (): Promise<void> => {
    await stop()
  }, [stop])
  const handleOpenModelPicker = useCallback(async (): Promise<void> => {
    setShowModelPicker(true)
  }, [])
  const handleComposerKeyDown = useCallback(
    (event: React.KeyboardEvent<LauncherInputElement>): void => {
      if (event.key !== "Enter") {
        return
      }

      const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean }

      if (nativeEvent.isComposing === true || nativeEvent.keyCode === 229) {
        return
      }

      if (event.shiftKey) {
        return
      }

      if (event.ctrlKey) {
        const input = inputRef.current

        if (!input) {
          return
        }

        event.preventDefault()
        setQuery(insertTextAtSelection(input, "\n"))
        return
      }

      if (event.metaKey || event.altKey) {
        return
      }

      event.preventDefault()
      runPrimaryAction()
    },
    [inputRef, runPrimaryAction, setQuery]
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
          pendingApproval ? undefined : (
            <form
              className="flex h-full w-full shrink-0 flex-col justify-end px-[var(--launcher-ai-composer-page-x)] py-[var(--ow-space-2)]"
              onSubmit={(event) => {
                event.preventDefault()
                runPrimaryAction()
              }}
            >
              {conversation.isLoading ? (
                <div className="mx-auto mb-[var(--ow-space-1)] w-full max-w-[var(--launcher-ai-content-max-width)] px-[var(--ow-space-2)]">
                  <ThinkingBar text={copy.chat.agentThinking} />
                </div>
              ) : null}

              <PromptInput
                className="mx-auto w-full max-w-[var(--launcher-ai-content-max-width)] px-[var(--ow-space-2)] py-[var(--ow-space-1)]"
                isLoading={isBusy}
                maxHeight="var(--launcher-ai-composer-input-max-h)"
                minHeight="var(--launcher-ai-composer-input-min-h)"
                onSubmit={runPrimaryAction}
                onValueChange={setQuery}
                textareaRef={inputRef as RefObject<HTMLTextAreaElement | null>}
                value={query}
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
                      ref={inputRef as RefObject<HTMLTextAreaElement | null>}
                      onKeyDown={handleComposerKeyDown}
                      placeholder={copy.launcher.aiInputPlaceholder}
                      submitOnEnter={false}
                      className="w-full py-[7px] [font-size:var(--ow-font-control)] font-medium leading-[var(--ow-line-chat)]"
                    />

                    <LauncherAttachmentStrip
                      attachments={attachmentDraft.attachments}
                      onRemove={attachmentDraft.removeAttachment}
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
                        onClick={runPrimaryAction}
                        onMouseDown={(event) => event.preventDefault()}
                        disabled={primaryActionDisabled}
                        icon={<ArrowUp className="size-[var(--ow-icon-sm)]" />}
                        label={copy.launcher.aiPrimaryLabel}
                        title={`${copy.launcher.aiPrimaryLabel} (${submitShortcutLabel})`}
                        tooltip={`${copy.launcher.aiPrimaryLabel} (${submitShortcutLabel})`}
                        className="bg-background-secondary/72 text-foreground hover:bg-background-secondary"
                      />
                    )}
                  </div>
                </div>
              </PromptInput>
            </form>
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
        inputStatus={inputStatus}
        inputRef={inputRef}
        showInputStatusIndicator={false}
        hideInputChrome
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
            onBranch={handleBranchChat}
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
