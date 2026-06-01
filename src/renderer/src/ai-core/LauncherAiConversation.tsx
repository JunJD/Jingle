import { AlertCircle, X } from "lucide-react"
import { Messages } from "@/components/chat/Messages"
import { ChatTodos } from "@/components/chat/ChatTodos"
import { IncludedMemoriesPanel } from "@/components/chat/IncludedMemoriesPanel"
import { MemoryReviewPanel } from "@/components/chat/MemoryReviewPanel"
import type { HITLRequest, ThreadForkState, Todo } from "@/types"
import { useI18n } from "@/lib/i18n"
import type { MessagesProjection } from "@/lib/message-projection"
import type { RefObject } from "react"
import type { VListHandle } from "virtua"

export function LauncherAiEmptyState(props: {
  bottomInset?: number
  error?: string | null
}): React.JSX.Element {
  const { copy } = useI18n()
  const { bottomInset = 0, error } = props

  return (
    <div
      className="relative flex flex-1 items-center justify-center overflow-hidden px-[var(--launcher-ai-content-x)]"
      style={
        bottomInset > 0
          ? {
              paddingBottom: bottomInset
            }
          : undefined
      }
    >
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

export function LauncherAiConversation(props: {
  bottomInset: number
  clearError: () => void
  error: string | null
  forkState: ThreadForkState
  isAtBottom: boolean
  isLoading: boolean
  isScrolling: boolean
  messageProjection: MessagesProjection
  onBranch?: (messageId?: string) => Promise<void>
  onRetry: () => Promise<void>
  onScroll: () => void
  onScrollEnd: () => void
  onScrollToLatest: () => void
  onUserScrollIntent: () => void
  pendingApproval: HITLRequest | null
  runId: string | null
  threadId: string
  todos: Todo[]
  virtualizerRef: RefObject<VListHandle | null>
}): React.JSX.Element {
  const { copy } = useI18n()
  const {
    bottomInset,
    clearError,
    error,
    forkState,
    isAtBottom,
    isLoading,
    isScrolling,
    messageProjection,
    onBranch,
    onRetry,
    onScroll,
    onScrollEnd,
    onScrollToLatest,
    onUserScrollIntent,
    pendingApproval,
    runId,
    threadId,
    todos,
    virtualizerRef
  } = props
  const hasVisibleTurns = messageProjection.turns.length > 0

  if (!hasVisibleTurns && !isLoading && !error) {
    return <LauncherAiEmptyState bottomInset={bottomInset} />
  }

  return (
    <div className="relative min-h-0 flex-1">
      <Messages
        bottomInset={bottomInset}
        contentClassName="mx-auto w-full min-w-0 max-w-[var(--launcher-ai-content-max-width)] px-[var(--launcher-ai-content-x)]"
        contentInsetY="var(--launcher-ai-content-y)"
        density="compact"
        footerSlot={
          <div className="flex w-full min-w-0 flex-col gap-[var(--launcher-ai-turn-gap)]">
            {!isLoading && todos.length > 0 && (pendingApproval || hasVisibleTurns) && (
              <ChatTodos todos={todos} />
            )}

            {isLoading && todos.length > 0 && <ChatTodos todos={todos} />}

            {!isLoading && <IncludedMemoriesPanel runId={runId} />}

            {!isLoading && <MemoryReviewPanel threadId={threadId} />}

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
        }
        isAtBottom={isAtBottom}
        isLoading={isLoading}
        isScrolling={isScrolling}
        onBranch={forkState.canFork ? onBranch : undefined}
        onRetry={onRetry}
        onScroll={onScroll}
        onScrollEnd={onScrollEnd}
        onScrollToLatest={onScrollToLatest}
        onUserScrollIntent={onUserScrollIntent}
        pendingApproval={pendingApproval}
        projection={messageProjection}
        virtualizerRef={virtualizerRef}
      />
    </div>
  )
}
