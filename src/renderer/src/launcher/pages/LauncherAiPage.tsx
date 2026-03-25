import { ArrowLeft } from "lucide-react"
import type { LauncherFeaturePageRenderProps } from "./types"
import { useLauncherAiSession } from "../hooks/useLauncherAiSession"
import { LauncherAiConversation, LauncherAiEmptyState } from "./LauncherAiConversation"
import { LauncherChrome } from "../components/LauncherChrome"
import { useI18n } from "@/lib/i18n"

export function LauncherAiPage(props: LauncherFeaturePageRenderProps): React.JSX.Element {
  const { copy } = useI18n()
  const { inputRef, onBack, seedQuery, shellConfig } = props

  const session = useLauncherAiSession({
    seedQuery,
    onBack
  })

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
            className="flex appearance-none items-center gap-3 rounded-full border-0 bg-transparent px-2 py-1 text-[13px] font-medium text-foreground disabled:cursor-default disabled:opacity-45"
          >
            <span>{copy.launcher.aiPrimaryLabel}</span>
            <span
              className="rounded-full bg-[var(--launcher-surface-strong)] px-2.5 py-1 text-[11px] text-muted-foreground"
              style={{
                color: "var(--launcher-text-muted)"
              }}
            >
              ↵
            </span>
          </button>
        </>
      }
      headerLeading={
        <button
          type="button"
          onClick={onBack}
          onMouseDown={(event) => event.preventDefault()}
          className="flex h-9 w-9 shrink-0 appearance-none items-center justify-center rounded-full border-0 bg-[var(--launcher-surface-strong)] text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </button>
      }
      inputRef={inputRef}
      onInputKeyDown={session.handleInputKeyDown}
      placeholder={copy.launcher.aiInputPlaceholder}
      query={session.query}
      shellConfig={shellConfig}
      setQuery={session.setQuery}
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
