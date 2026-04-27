import { AlertCircle, ArrowDown, Loader2, X } from "lucide-react"
import { Messages } from "@/components/chat/Messages"
import { ChatTodos } from "@/components/chat/ChatTodos"
import type { HITLDecision, HITLRequest, Message, Todo } from "@/types"
import { useI18n } from "@/lib/i18n"
import { useStickToBottom } from "use-stick-to-bottom"

export function LauncherAiEmptyState(props: { error?: string | null }): React.JSX.Element {
  const { copy } = useI18n()
  const { error } = props

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-5">
      <div className="relative flex w-full max-w-3xl flex-col items-center text-center">
        <div className="text-section-header mb-2.5">{copy.launcher.aiEmptyEyebrow}</div>
        <h1 className="text-[24px] font-semibold tracking-normal text-foreground sm:text-[28px]">
          {copy.launcher.aiHeroTitle}
        </h1>
        <p className="mt-3 max-w-2xl text-[13px] leading-6 text-muted-foreground">
          {copy.launcher.aiHeroDescription}
        </p>
        {error ? (
          <div className="mt-6 flex w-full items-start gap-3 bg-destructive/8 px-4 py-3 text-left">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <div className="text-[var(--ow-font-body)] font-medium text-destructive">
                {copy.chat.agentError}
              </div>
              <div className="mt-1 break-words text-[var(--ow-font-body)] text-muted-foreground">
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
      className="launcher-jump-to-latest absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 bg-background/88 px-3 py-1.5 text-[11px] font-medium text-foreground backdrop-blur-md transition"
      onClick={onClick}
    >
      <span className="relative z-10 flex items-center gap-2">
        {isLoading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ArrowDown className="size-3.5" />
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
  isLoading: boolean
  onApprovalDecision: (decision: HITLDecision) => Promise<void>
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
    isLoading,
    onApprovalDecision,
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
        <div ref={contentRef} className="overflow-x-hidden px-4 py-3 sm:px-5">
          <div className="mx-auto flex w-full min-w-0 max-w-[840px] flex-col gap-4">
            <Messages
              density="compact"
              isLoading={isLoading}
              messages={displayMessages}
              onApprovalDecision={onApprovalDecision}
              onRetry={onRetry}
              pendingApproval={pendingApproval}
            />

            {!isLoading && todos.length > 0 && (pendingApproval || displayMessages.length > 0) && (
              <ChatTodos todos={todos} />
            )}

            {isLoading && (
              <div className="space-y-3 border-t border-border/80 pt-4">
                <div className="flex items-center gap-2 text-[var(--ow-font-body)] text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {copy.chat.agentThinking}
                </div>
                {todos.length > 0 && <ChatTodos todos={todos} />}
              </div>
            )}

            {error && !isLoading && (
              <div className="flex items-start gap-3 border-l-[3px] border-destructive bg-destructive/8 px-4 py-3">
                <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <div className="text-[var(--ow-font-body)] font-medium text-destructive">
                    {copy.chat.agentError}
                  </div>
                  <div className="mt-1 break-words text-[var(--ow-font-body)] text-muted-foreground">
                    {error}
                  </div>
                </div>
                <button
                  aria-label={copy.chat.dismissError}
                  className="shrink-0 rounded p-1 transition-colors hover:bg-destructive/20"
                  onClick={clearError}
                  type="button"
                >
                  <X className="size-4 text-muted-foreground" />
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
