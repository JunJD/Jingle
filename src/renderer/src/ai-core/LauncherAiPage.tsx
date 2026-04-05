import { ArrowLeft, Plus } from "lucide-react"
import { useCallback, useEffect, useRef } from "react"
import { formatLauncherCommandShortcut } from "@/shortcuts/format-shortcut"
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
  const session = useAiThread({
    buildMessageContent: attachmentDraft.buildMessageContent,
    onDidInvoke: attachmentDraft.clearAllAttachments
  })
  const inputStatus = session.inputStatus
  const { inputRef, setInputStatus } = surface
  const fileInputRef = useRef<HTMLInputElement>(null)
  const submitShortcut = formatLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiSubmit)
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
      session.runPrimaryAction()
    },
    [isAiInputTarget, session.runPrimaryAction]
  )
  const handleGoHomeShortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!isAiInputTarget(event.target) || session.query || session.isBusy) {
        return
      }

      event.preventDefault()
      navigation.goHome()
    },
    [isAiInputTarget, navigation, session.isBusy, session.query]
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
          <div className="text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
            {copy.launcher.aiFooterLeading}
          </div>
          <button
            type="button"
            onClick={session.runPrimaryAction}
            onMouseDown={(event) => event.preventDefault()}
            disabled={session.primaryActionDisabled}
            className="launcher-action-link flex appearance-none items-center gap-2 rounded-[10px] border-0 px-3 py-1 text-[13px] font-medium text-foreground disabled:cursor-default disabled:opacity-45"
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
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={navigation.goHome}
            onMouseDown={(event) => event.preventDefault()}
            className="launcher-icon-button flex h-9 w-9 shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-5" />
          </button>

          <div className="flex min-w-0 items-center gap-1.5">
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
              className="launcher-icon-button flex h-7 w-7 shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
            >
              <Plus className="size-3.5" />
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
      inputValue={session.query}
      onInputValueChange={session.setQuery}
      placeholders={[copy.launcher.aiInputPlaceholder, copy.launcher.aiInputPlaceholderSecondary]}
      shellConfig={surface.shellConfig}
      surface={AI_LAUNCHER_PLUGIN_ID}
    >
      {session.threadId ? (
        <LauncherAiConversation
          clearError={session.conversation.clearVisibleError}
          displayMessages={session.conversation.displayMessages}
          error={session.conversation.visibleError}
          isLoading={session.conversation.isLoading}
          onApprovalDecision={session.handleApprovalDecision}
          onRetry={session.retry}
          pendingApproval={session.conversation.pendingApproval}
          todos={session.conversation.todos}
        />
      ) : (
        <LauncherAiEmptyState error={session.conversation.visibleError} />
      )}
    </LauncherChrome>
  )
}
