import { AlertCircle, ArrowDown, Loader2, X } from "lucide-react"
import { Messages } from "@/components/chat/Messages"
import { ChatTodos } from "@/components/chat/ChatTodos"
import type { HITLDecision, HITLRequest, Message, ThreadForkState, Todo } from "@/types"
import { useI18n } from "@/lib/i18n"
import { useStickToBottom } from "use-stick-to-bottom"

export function LauncherAiEmptyState(props: { error?: string | null }): React.JSX.Element {
  const { copy } = useI18n()
  const { error } = props

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-[var(--launcher-ai-content-x)]">
      <div className="relative flex w-full max-w-[var(--launcher-ai-empty-max-width)] flex-col items-center text-center">
        <div className="text-section-header mb-[var(--ow-space-2-5)]">
          {copy.launcher.aiEmptyEyebrow}
        </div>
        <h1 className="[font-size:var(--launcher-ai-empty-title)] font-semibold tracking-normal text-foreground sm:[font-size:var(--launcher-ai-empty-title-wide)]">
          {copy.launcher.aiHeroTitle}
        </h1>
        <p className="mt-[var(--ow-space-3)] max-w-[var(--launcher-ai-empty-copy-max-width)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-muted-foreground">
          {copy.launcher.aiHeroDescription}
        </p>
        {error ? (
          <div className="mt-[var(--ow-space-6)] flex w-full items-start gap-[var(--ow-gap-md)] bg-destructive/8 px-[var(--ow-space-4)] py-[var(--ow-space-3)] text-left">
            <AlertCircle className="mt-[var(--ow-leading-nudge)] size-[var(--ow-icon-md)] shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <div className="[font-size:var(--ow-font-body)] font-medium text-destructive">
                {copy.chat.agentError}
              </div>
              <div className="mt-1 break-words [font-size:var(--ow-font-body)] text-muted-foreground">
                {error}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function LauncherJumpToLatestButton(props: {
  isLoading: boolean
  label: string
  onClick: () => void
}): React.JSX.Element {
  const { isLoading, label, onClick } = props

  return (
    <button
      type="button"
      className="launcher-jump-to-latest absolute bottom-[var(--launcher-jump-bottom)] left-1/2 flex -translate-x-1/2 items-center gap-[var(--ow-gap-sm)] bg-background/88 px-[var(--ow-space-3)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-meta)] font-medium text-foreground backdrop-blur-md transition"
      onClick={onClick}
    >
      <span className="relative z-10 flex items-center gap-[var(--ow-gap-sm)]">
        {isLoading ? (
          <Loader2 className="size-[var(--ow-icon-sm)] animate-spin" />
        ) : (
          <ArrowDown className="size-[var(--ow-icon-sm)]" />
        )}
        {label}
      </span>
    </button>
  )
}

export function LauncherAiConversation(props: {
  clearError: () => void
  displayMessages: Message[]
  error: string | null
  forkState: ThreadForkState
  isLoading: boolean
  onApprovalDecision: (decision: HITLDecision) => Promise<void>
  onBranch?: (messageId?: string) => Promise<void>
  onRetry: () => Promise<void>
  pendingApproval: HITLRequest | null
  todos: Todo[]
}): React.JSX.Element {
  const { copy } = useI18n()
  const { contentRef, isAtBottom, scrollRef, scrollToBottom } = useStickToBottom({
    initial: "instant",
    resize: "smooth"
  })
  const {
    clearError,
    displayMessages,
    error,
    forkState,
    isLoading,
    onApprovalDecision,
    onBranch,
    onRetry,
    pendingApproval,
    todos
  } = props

  if (!displayMessages.length && !isLoading && !error) {
    return <LauncherAiEmptyState />
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="h-full overflow-x-hidden overflow-y-scroll overscroll-contain scrollbar-hide"
      >
        <div
          ref={contentRef}
          className="overflow-x-hidden px-[var(--launcher-ai-content-x)] py-[var(--launcher-ai-content-y)]"
        >
          <div className="mx-auto flex w-full min-w-0 max-w-[var(--launcher-ai-content-max-width)] flex-col gap-[var(--launcher-ai-turn-gap)]">
            <Messages
              approvalPlacement="composer"
              density="compact"
              isLoading={isLoading}
              messages={displayMessages}
              onApprovalDecision={onApprovalDecision}
              onBranch={forkState.canFork ? onBranch : undefined}
              onRetry={onRetry}
              pendingApproval={pendingApproval}
            />

            {!isLoading && todos.length > 0 && (pendingApproval || displayMessages.length > 0) && (
              <ChatTodos todos={todos} />
            )}

            {isLoading && todos.length > 0 && <ChatTodos todos={todos} />}

            {error && !isLoading && (
              <div className="flex items-start gap-[var(--ow-gap-md)] border-l-[3px] border-destructive bg-destructive/8 px-[var(--ow-space-4)] py-[var(--ow-space-3)]">
                <AlertCircle className="mt-[var(--ow-leading-nudge)] size-[var(--ow-icon-md)] shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <div className="[font-size:var(--ow-font-body)] font-medium text-destructive">
                    {copy.chat.agentError}
                  </div>
                  <div className="mt-1 break-words [font-size:var(--ow-font-body)] text-muted-foreground">
                    {error}
                  </div>
                </div>
                <button
                  aria-label={copy.chat.dismissError}
                  className="shrink-0 rounded p-[var(--ow-space-1)] transition-colors hover:bg-destructive/20"
                  onClick={clearError}
                  type="button"
                >
                  <X className="size-[var(--ow-icon-action)] text-muted-foreground" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {!isAtBottom && (
        <LauncherJumpToLatestButton
          isLoading={isLoading}
          label={copy.launcher.jumpToLatest}
          onClick={() => void scrollToBottom({ animation: "smooth" })}
        />
      )}
    </div>
  )
}
