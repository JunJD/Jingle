import { AlertCircle, X } from "lucide-react"
import { Messages } from "@/components/chat/Messages"
import { ChatTodos } from "@/components/chat/ChatTodos"
import { ChatJumpToLatestButton } from "@/components/chat/ChatJumpToLatestButton"
import { IncludedMemoriesPanel } from "@/components/chat/IncludedMemoriesPanel"
import { MemoryReviewPanel } from "@/components/chat/MemoryReviewPanel"
import { SubagentReferencesPanel } from "@/components/chat/SubagentReferencesPanel"
import { useVirtualChatScrollIntent } from "@/components/chat/useVirtualChatScrollIntent"
import type { HITLRequest, Subagent, Todo } from "@/types"
import { useI18n } from "@/lib/i18n"
import { projectSubagentReferences } from "@/lib/subagent-view"
import { useThreadSelector } from "@/lib/thread-context"
import type { ComposerMessageInput } from "@shared/message-content"
import { memo, useCallback, useMemo, useRef } from "react"
import type { VListHandle } from "virtua"

const EMPTY_SUBAGENTS: readonly Subagent[] = []
const EMPTY_TODOS: readonly Todo[] = []
const LAUNCHER_AI_AT_BOTTOM_THRESHOLD_PX = 60

function LauncherAiPresenceMark(): React.JSX.Element {
  return (
    <div className="launcher-ai-presence" aria-hidden="true">
      <div className="launcher-ai-presence__halo" />
      <svg
        className="launcher-ai-presence__mark"
        viewBox="0 0 100 100"
        role="img"
        focusable="false"
      >
        <path
          className="launcher-ai-presence__capsule"
          d="M24 50c0-10 8-18 18-18h20c10 0 18 8 18 18s-8 18-18 18H42c-10 0-18-8-18-18Z"
        />
        <circle className="launcher-ai-presence__lens" cx="35" cy="50" r="7" />
        <path className="launcher-ai-presence__lens-handle" d="M42 57l8 8" />
        <path className="launcher-ai-presence__mouth" d="M52 50h12" />
        <circle className="launcher-ai-presence__eye" cx="71" cy="50" r="7" />
        <path className="launcher-ai-presence__signal" d="M61 25c8-5 18-3 25 5" />
      </svg>
    </div>
  )
}

const LauncherAiFooter = memo(function LauncherAiFooter(props: {
  clearError: () => void
  error: string | null
  hasVisibleTurns: boolean
  isLoading: boolean
  pendingApproval: HITLRequest | null
  threadId: string
  todos: readonly Todo[]
}): React.JSX.Element {
  const { clearError, error, hasVisibleTurns, isLoading, pendingApproval, threadId, todos } = props
  const { copy } = useI18n()
  const runId = useThreadSelector(threadId, (state) => state?.agent.runId ?? null)
  const subagents = useThreadSelector(
    threadId,
    (state) => state?.agent.subagents ?? EMPTY_SUBAGENTS
  )
  const subagentReferences = useMemo(() => projectSubagentReferences(subagents), [subagents])

  return (
    <div className="flex w-full min-w-0 flex-col gap-[var(--launcher-ai-turn-gap)]">
      {!isLoading && todos.length > 0 && (pendingApproval || hasVisibleTurns) && (
        <ChatTodos todos={todos} />
      )}

      {isLoading && todos.length > 0 && <ChatTodos todos={todos} />}

      {!isLoading && <IncludedMemoriesPanel runId={runId} />}

      {!isLoading && <SubagentReferencesPanel references={subagentReferences} />}

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
  )
})

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
        <LauncherAiPresenceMark />
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
  isLoading: boolean
  onBranch?: (messageId?: string) => Promise<void>
  onRetry: (input: ComposerMessageInput) => Promise<void> | void
  pendingApproval: HITLRequest | null
  threadId: string
}): React.JSX.Element {
  const {
    bottomInset,
    clearError,
    error,
    isLoading,
    onBranch,
    onRetry,
    pendingApproval,
    threadId
  } = props

  return (
    <LauncherAiConversationViewport
      bottomInset={bottomInset}
      clearError={clearError}
      error={error}
      isLoading={isLoading}
      onBranch={onBranch}
      onRetry={onRetry}
      pendingApproval={pendingApproval}
      threadId={threadId}
    />
  )
}

const LauncherAiConversationViewport = memo(function LauncherAiConversationViewport(props: {
  bottomInset: number
  clearError: () => void
  error: string | null
  isLoading: boolean
  onBranch?: (messageId?: string) => Promise<void>
  onRetry: (input: ComposerMessageInput) => Promise<void> | void
  pendingApproval: HITLRequest | null
  threadId: string
}): React.JSX.Element {
  const { copy } = useI18n()
  const {
    bottomInset,
    clearError,
    error,
    isLoading,
    onBranch,
    onRetry,
    pendingApproval,
    threadId
  } = props
  const virtualizerRef = useRef<VListHandle>(null)
  const hasVisibleTurns = useThreadSelector(
    threadId,
    (state) => (state?.view.messageProjection.turns.length ?? 0) > 0
  )
  const displayRowCount = useThreadSelector(
    threadId,
    (state) => state?.view.messageProjection.displayRows.length ?? 0
  )
  const todos = useThreadSelector(threadId, (state) => state?.agent.todos ?? EMPTY_TODOS)
  const canFork = useThreadSelector(threadId, (state) => state?.agent.forkState.canFork ?? true)
  const chatVirtualItemCount = hasVisibleTurns || isLoading || error ? displayRowCount : 0
  const {
    forceScrollToLatest,
    handleScroll,
    handleScrollEnd,
    isAtBottom,
    isScrolling,
    jumpToLatestBottomPx,
    markUserScrollIntent,
    scrollToLatest,
    showJumpToLatest
  } = useVirtualChatScrollIntent({
    atBottomThresholdPx: LAUNCHER_AI_AT_BOTTOM_THRESHOLD_PX,
    bottomInsetPx: bottomInset,
    resetKey: threadId,
    totalCount: chatVirtualItemCount,
    virtualizerRef
  })
  const renderFooter = useCallback(
    () => (
      <LauncherAiFooter
        clearError={clearError}
        error={error}
        hasVisibleTurns={hasVisibleTurns}
        isLoading={isLoading}
        pendingApproval={pendingApproval}
        threadId={threadId}
        todos={todos}
      />
    ),
    [clearError, error, hasVisibleTurns, isLoading, pendingApproval, threadId, todos]
  )

  if (!hasVisibleTurns && !isLoading && !error) {
    return <LauncherAiEmptyState bottomInset={bottomInset} />
  }

  return (
    <div className="relative min-h-0 flex-1">
      <Messages
        bottomInset={bottomInset}
        contentClassName="mx-auto w-full min-w-0 max-w-[var(--launcher-ai-content-max-width)] px-[var(--launcher-ai-content-x)]"
        contentInsetY="var(--launcher-ai-content-y)"
        isAtBottom={isAtBottom}
        isLoading={isLoading}
        isScrolling={isScrolling}
        onBranch={canFork ? onBranch : undefined}
        onRetry={onRetry}
        renderFooter={renderFooter}
        onScroll={handleScroll}
        onScrollEnd={handleScrollEnd}
        onScrollToLatest={scrollToLatest}
        onUserScrollIntent={markUserScrollIntent}
        threadId={threadId}
        virtualizerRef={virtualizerRef}
      />
      {showJumpToLatest ? (
        <div
          className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-[var(--launcher-ai-composer-page-x)]"
          style={{
            bottom: jumpToLatestBottomPx
          }}
        >
          <ChatJumpToLatestButton
            className="pointer-events-auto"
            isLoading={isLoading}
            label={copy.launcher.jumpToLatest}
            onClick={forceScrollToLatest}
          />
        </div>
      ) : null}
    </div>
  )
})
