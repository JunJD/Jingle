import { ArrowLeft, Plus, MessageSquare } from "lucide-react"
import { useCallback, useEffect, useRef } from "react"
import { useLauncherCommandShortcut } from "@/shortcuts/format-shortcut"
import { useShortcutCommandHandler, useShortcutScopeLayer } from "@/shortcuts/shortcut-context"
import { AI_LAUNCHER_PLUGIN_ID } from "@shared/launcher-ai"
import { AI_ATTACHMENT_FILE_EXTENSIONS } from "@shared/launcher-attachments"
import { LAUNCHER_COMMAND_IDS } from "@shared/shortcuts/ids"
import { LauncherChrome } from "@launcher-components/LauncherChrome"
import { LauncherAiConversation, LauncherAiEmptyState } from "./LauncherAiConversation"
import { useAiCoreNavigation, useAiCoreSurface } from "./AiCoreHost"
import { LauncherAttachmentStrip } from "./LauncherAttachmentStrip"
import { useAiAttachments } from "./useAiAttachments"
import { useAiThread } from "./useAiThread"
import { useI18n } from "@/lib/i18n"
import { useDisableTabNavigation } from "@/lib/use-disable-tab-navigation"

const AI_SHORTCUT_SCOPES = ["launcher.ai"] as const

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
    primaryActionDisabled,
    query,
    retry,
    runPrimaryAction,
    setQuery,
    threadId
  } = useAiThread({
    messageRefs: attachmentDraft.messageRefs,
    onDidInvoke: attachmentDraft.clearAllAttachments
  })
  const { inputRef, setInputStatus } = surface
  const fileInputRef = useRef<HTMLInputElement>(null)
  const submitShortcut = useLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiSubmit)
  const isAiInputTarget = useCallback(
    (target: EventTarget | null): boolean => target === inputRef.current,
    [inputRef]
  )
  const handleSubmitShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!isAiInputTarget(event.target)) {
        return
      }

      event.preventDefault()
      runPrimaryAction()
    },
    [isAiInputTarget, runPrimaryAction]
  )
  const handleGoHomeShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!isAiInputTarget(event.target) || query || isBusy) {
        return
      }

      event.preventDefault()
      navigation.goHome()
    },
    [isAiInputTarget, isBusy, navigation, query]
  )

  useShortcutScopeLayer(AI_SHORTCUT_SCOPES)
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.aiSubmit, handleSubmitShortcut)
  useShortcutCommandHandler(LAUNCHER_COMMAND_IDS.aiGoHome, handleGoHomeShortcut)
  useDisableTabNavigation(inputRef)

  useEffect(() => {
    setInputStatus(inputStatus)

    return () => {
      setInputStatus("idle")
    }
  }, [inputStatus, setInputStatus])

  return (
    <LauncherChrome
      footer={
        <>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            <button
              type="button"
              onClick={() => {
                void window.api.mainWindow.openThread(threadId || '')
              }}
              onMouseDown={(event) => event.preventDefault()}
              className="launcher-icon-button flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
              title={copy.locale === "zh-CN" ? "打开聊天历史" : "Open chat history"}
              aria-label={copy.locale === "zh-CN" ? "打开聊天历史" : "Open chat history"}
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
            <span>{copy.launcher.aiFooterLeading}</span>
          </div>
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
        </>
      }
      headerLeading={
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={navigation.goHome}
            onMouseDown={(event) => event.preventDefault()}
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
              onClick={() => {
                fileInputRef.current?.click()
              }}
              onMouseDown={(event) => event.preventDefault()}
              aria-label={copy.launcher.aiAddAttachment}
              title={copy.launcher.aiAddAttachment}
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
  )
}
