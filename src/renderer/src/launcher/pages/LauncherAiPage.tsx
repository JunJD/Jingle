import { ArrowLeft, Plus } from "lucide-react"
import { useEffect, useRef } from "react"
import { formatLauncherCommandShortcut } from "@/shortcuts/format-shortcut"
import { AI_LAUNCHER_PLUGIN_ID } from "../../../../plugins/ai/manifest"
import { AI_ATTACHMENT_FILE_EXTENSIONS } from "../../../../shared/launcher-attachments"
import { LAUNCHER_COMMAND_IDS } from "../../../../shared/shortcuts/ids"
import { useLauncherPluginNavigation, useLauncherPluginSurface } from "../LauncherPluginHost"
import { LauncherAttachmentStrip } from "../components/LauncherAttachmentStrip"
import { useAiThread } from "../hooks/useAiThread"
import { useLauncherAiAttachments } from "../hooks/useLauncherAiAttachments"
import { LauncherAiConversation, LauncherAiEmptyState } from "./LauncherAiConversation"
import { LauncherChrome } from "../components/LauncherChrome"
import { useI18n } from "@/lib/i18n"
import { useDisableTabNavigation } from "@/lib/use-disable-tab-navigation"

export function LauncherAiPage(): React.JSX.Element {
  const { copy } = useI18n()
  const attachmentDraft = useLauncherAiAttachments()
  const navigation = useLauncherPluginNavigation()
  const surface = useLauncherPluginSurface()
  const session = useAiThread({
    buildMessageContent: attachmentDraft.buildMessageContent,
    onDidInvoke: attachmentDraft.clearAllAttachments
  })
  const inputStatus = session.inputStatus
  const { inputRef, setInputStatus } = surface
  const fileInputRef = useRef<HTMLInputElement>(null)
  const submitShortcut = formatLauncherCommandShortcut(LAUNCHER_COMMAND_IDS.aiSubmit)
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
      onInputKeyDown={session.handleInputKeyDown}
      onInputValueChange={session.setQuery}
      placeholder={copy.launcher.aiInputPlaceholder}
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
