import { ArrowLeft } from "lucide-react"
import { useEffect } from "react"
import { useLauncherPluginHost } from "../LauncherPluginHost"
import { useAiThread } from "../hooks/useAiThread"
import { ClipboardChip } from "../components/ClipboardChip"
import { LauncherAiConversation, LauncherAiEmptyState } from "./LauncherAiConversation"
import { LauncherChrome } from "../components/LauncherChrome"
import { useI18n } from "@/lib/i18n"
import { useDisableTabNavigation } from "@/lib/use-disable-tab-navigation"

export function LauncherAiPage(): React.JSX.Element {
  const { copy } = useI18n()
  const host = useLauncherPluginHost()
  const session = useAiThread()
  const inputStatus = session.isBusy ? "pending" : "idle"
  const { inputRef, setInputStatus } = host.surface
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
            className="launcher-action-button launcher-action-button--primary flex appearance-none items-center gap-3 border-0 px-2 py-1 text-[13px] font-medium text-foreground disabled:cursor-default disabled:opacity-45"
          >
            <span>{copy.launcher.aiPrimaryLabel}</span>
            <span className="launcher-keycap rounded-full px-2.5 py-1 text-[11px] text-muted-foreground">
              ↵
            </span>
          </button>
        </>
      }
      headerLeading={
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={host.navigation.goHome}
            onMouseDown={(event) => event.preventDefault()}
            className="launcher-icon-button flex h-9 w-9 shrink-0 appearance-none items-center justify-center rounded-full border-0 text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-5" />
          </button>

          <ClipboardChip context={host.clipboard.context} onClear={host.clipboard.clearContext} />
        </div>
      }
      inputStatus={inputStatus}
      inputRef={inputRef}
      inputValue={session.query}
      onInputKeyDown={session.handleInputKeyDown}
      onInputValueChange={session.setQuery}
      placeholder={copy.launcher.aiInputPlaceholder}
      shellConfig={host.surface.shellConfig}
      surface="ai"
    >
      {session.threadId ? (
        <LauncherAiConversation
          clearError={session.conversation.clearVisibleError}
          displayMessages={session.conversation.displayMessages}
          error={session.conversation.visibleError}
          isLoading={session.conversation.isLoading}
          onApprovalDecision={session.handleApprovalDecision}
          pendingApproval={session.conversation.pendingApproval}
          todos={session.conversation.todos}
          toolResults={session.conversation.toolResults}
        />
      ) : (
        <LauncherAiEmptyState error={session.conversation.visibleError} />
      )}
    </LauncherChrome>
  )
}
