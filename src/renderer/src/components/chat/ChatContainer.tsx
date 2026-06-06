import { memo, useRef, useEffect, useCallback, useMemo, useState } from "react"
import { AlertCircle, Brain, Folder, Send, Shield, Square, X } from "lucide-react"
import type { VListHandle } from "virtua"
import { PromptInput, PromptInputAction, PromptInputTextarea } from "@/components/agent-ui"
import { useThreadActions, useThreadSelector } from "@/lib/thread-context"
import type { AgentRunValidator } from "@/lib/agent-control"
import { useAgent } from "@/lib/use-agent"
import { Messages } from "./Messages"
import { MemoryReviewPanel } from "./MemoryReviewPanel"
import { ModelSwitcher } from "./ModelSwitcher"
import { IncludedMemoriesPanel } from "./IncludedMemoriesPanel"
import { WorkspacePicker } from "./WorkspacePicker"
import { selectWorkspaceFolder } from "@/lib/workspace-utils"
import { ChatTodos } from "./ChatTodos"
import { ChatJumpToLatestButton } from "./ChatJumpToLatestButton"
import { ComposerApprovalPrompt } from "./ComposerApprovalPrompt"
import { ContextUsageIndicator } from "./ContextUsageIndicator"
import { useVirtualChatScrollIntent } from "./useVirtualChatScrollIntent"
import { useI18n } from "@/lib/i18n"
import { useDisableTabNavigation } from "@/lib/use-disable-tab-navigation"
import { listNativeExtensionSourceMentions } from "@extensions/source-mentions"
import type { ComposerAreaHandle } from "@/composer-area"
import { hasComposerMessageInputContent, type ComposerMessageInput } from "@shared/message-content"
import type { HITLRequest, Todo } from "@/types"

interface ChatContainerProps {
  threadId: string
}

const EMPTY_TOKEN_USAGE = null
const EMPTY_TODOS: readonly Todo[] = []

const ChatFooter = memo(function ChatFooter(props: {
  clearError: () => void
  hasVisibleTurns: boolean
  isBusy: boolean
  isLoading: boolean
  pendingApproval: HITLRequest | null
  threadId: string
  todos: readonly Todo[]
  visibleError: string | null
}): React.JSX.Element {
  const {
    clearError,
    hasVisibleTurns,
    isBusy,
    isLoading,
    pendingApproval,
    threadId,
    todos,
    visibleError
  } = props
  const { copy } = useI18n()
  const runId = useThreadSelector(threadId, (state) => state?.agent.runId ?? null)

  return (
    <div className="flex flex-col gap-[var(--ow-chat-thread-gap)]">
      {!isLoading && todos.length > 0 && (pendingApproval || hasVisibleTurns) && (
        <ChatTodos todos={todos} />
      )}

      {isBusy && todos.length > 0 && <ChatTodos todos={todos} />}

      {!isBusy && <IncludedMemoriesPanel runId={runId} />}

      {!isBusy && <MemoryReviewPanel threadId={threadId} />}

      {visibleError && !isBusy && (
        <div className="flex items-start gap-[var(--ow-gap-md)] border-l-[3px] border-destructive bg-destructive/8 px-[var(--ow-space-4)] py-[var(--ow-space-3)]">
          <AlertCircle className="mt-[var(--ow-leading-nudge)] size-[var(--ow-icon-md)] shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="[font-size:var(--ow-font-body)] font-medium text-destructive">
              {copy.chat.agentError}
            </div>
            <div className="mt-[var(--ow-space-1)] break-words [font-size:var(--ow-font-body)] text-muted-foreground">
              {visibleError}
            </div>
            <div className="mt-[var(--ow-space-2)] [font-size:var(--ow-font-meta)] text-muted-foreground">
              {copy.chat.agentErrorRecovery}
            </div>
          </div>
          <button
            onClick={clearError}
            className="shrink-0 rounded p-[var(--ow-space-1)] transition-colors hover:bg-destructive/20"
            aria-label={copy.chat.dismissError}
          >
            <X className="size-[var(--ow-icon-action)] text-muted-foreground" />
          </button>
        </div>
      )}
    </div>
  )
})

const ChatThreadViewport = memo(function ChatThreadViewport(props: {
  clearError: () => void
  isBusy: boolean
  isLoading: boolean
  onRetry: (input: ComposerMessageInput) => Promise<void> | void
  onSelectWorkspace: () => Promise<void> | void
  pendingApproval: HITLRequest | null
  threadId: string
  visibleError: string | null
  workspaceChangeError: string | null
}): React.JSX.Element {
  const {
    clearError,
    isBusy,
    isLoading,
    onRetry,
    onSelectWorkspace,
    pendingApproval,
    threadId,
    visibleError,
    workspaceChangeError
  } = props
  const { copy } = useI18n()
  const virtualizerRef = useRef<VListHandle>(null)
  const workspacePath = useThreadSelector(threadId, (state) => state?.agent.workspacePath ?? null)
  const hasVisibleTurns = useThreadSelector(
    threadId,
    (state) => (state?.view.messageProjection.turns.length ?? 0) > 0
  )
  const displayRowCount = useThreadSelector(
    threadId,
    (state) => state?.view.messageProjection.displayRows.length ?? 0
  )
  const todos = useThreadSelector(threadId, (state) => state?.agent.todos ?? EMPTY_TODOS)
  const showEmptyChat = !hasVisibleTurns && !isLoading && !visibleError
  const chatVirtualItemCount = showEmptyChat ? 0 : displayRowCount

  const {
    forceScrollToLatest,
    handleScroll: handleChatScroll,
    handleScrollEnd: handleChatScrollEnd,
    isAtBottom,
    isScrolling,
    jumpToLatestBottomPx,
    markUserScrollIntent,
    scrollToLatest,
    showJumpToLatest
  } = useVirtualChatScrollIntent({
    resetKey: threadId,
    totalCount: chatVirtualItemCount,
    virtualizerRef
  })

  const handleDismissError = useCallback((): void => {
    clearError()
  }, [clearError])
  const renderFooter = useCallback(
    () => (
      <ChatFooter
        clearError={handleDismissError}
        hasVisibleTurns={hasVisibleTurns}
        isBusy={isBusy}
        isLoading={isLoading}
        pendingApproval={pendingApproval}
        threadId={threadId}
        todos={todos}
        visibleError={visibleError}
      />
    ),
    [
      handleDismissError,
      hasVisibleTurns,
      isBusy,
      isLoading,
      pendingApproval,
      threadId,
      todos,
      visibleError
    ]
  )

  return (
    <div className="relative min-h-0 flex-1">
      {showEmptyChat ? (
        <div className="h-full overflow-y-auto px-[var(--ow-chat-thread-x)] py-[var(--ow-chat-thread-y)]">
          <div className="mx-auto max-w-[var(--ow-chat-thread-max-width)]">
            <div className="flex flex-col items-center justify-center py-[var(--ow-chat-empty-y)] text-muted-foreground">
              <div className="mb-3 text-section-header">{copy.chat.newThreadEyebrow}</div>
              {workspacePath ? (
                <div className="text-center">
                  <div className="[font-size:var(--ow-chat-hero-title)] font-semibold tracking-normal text-foreground">
                    {copy.chat.startConversation}
                  </div>
                  <div className="mt-[var(--ow-space-3)] [font-size:var(--ow-font-body)] text-muted-foreground">
                    {copy.chat.describeOutcome}
                  </div>
                </div>
              ) : (
                <div className="space-y-[var(--ow-space-3)] text-center [font-size:var(--ow-font-body)]">
                  <div>
                    <span className="text-status-warning">{copy.chat.selectWorkspaceTitle}</span>
                    <span className="mt-[var(--ow-space-1)] block [font-size:var(--ow-font-meta)] opacity-75">
                      {copy.chat.selectWorkspaceHint}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-[var(--ow-control-h-md)] items-center justify-center gap-[var(--ow-space-1-5)] rounded-full bg-background-secondary px-[var(--ow-space-3)] [font-size:var(--ow-font-meta)] text-status-warning transition-colors duration-100 hover:bg-background-interactive disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void onSelectWorkspace()}
                  >
                    <Folder className="size-[var(--ow-icon-sm)]" />
                    <span className="max-w-[var(--ow-chip-label-max-width)] truncate">
                      {copy.chat.selectWorkspace}
                    </span>
                  </button>
                  {workspaceChangeError ? (
                    <div className="mx-auto max-w-[var(--ow-chat-empty-copy-max-width)] [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-status-warning">
                      {workspaceChangeError}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <Messages
          bottomInset={0}
          contentClassName="mx-auto w-full max-w-[var(--ow-chat-thread-max-width)] px-[var(--ow-chat-thread-x)]"
          contentInsetY="var(--ow-chat-thread-y)"
          isAtBottom={isAtBottom}
          isLoading={isLoading}
          isScrolling={isScrolling}
          onRetry={onRetry}
          onScroll={handleChatScroll}
          onScrollEnd={handleChatScrollEnd}
          onScrollToLatest={scrollToLatest}
          onUserScrollIntent={markUserScrollIntent}
          renderFooter={renderFooter}
          threadId={threadId}
          virtualizerRef={virtualizerRef}
        />
      )}

      {showJumpToLatest && (
        <div
          className="absolute left-1/2 z-10 -translate-x-1/2"
          style={{ bottom: jumpToLatestBottomPx }}
        >
          <ChatJumpToLatestButton
            isLoading={isBusy}
            label={copy.launcher.jumpToLatest}
            onClick={forceScrollToLatest}
          />
        </div>
      )}
    </div>
  )
})

export function ChatContainer({ threadId }: ChatContainerProps): React.JSX.Element {
  const { copy, locale } = useI18n()
  const sourceMentions = useMemo(
    () => listNativeExtensionSourceMentions(window.electron.process.platform, locale),
    [locale]
  )
  const inputRef = useRef<ComposerAreaHandle>(null)
  const [temporaryMode, setTemporaryMode] = useState(false)
  const [workspaceChangeError, setWorkspaceChangeError] = useState<string | null>(null)
  useDisableTabNavigation(inputRef)

  const threadActions = useThreadActions(threadId)!
  const tokenUsage = useThreadSelector(
    threadId,
    (state) => state?.agent.tokenUsage ?? EMPTY_TOKEN_USAGE
  )
  const currentModel = useThreadSelector(threadId, (state) => state?.agent.currentModel ?? null)
  const input = useThreadSelector(threadId, (state) => state?.ui.draftInput ?? "")
  const validateRun = useCallback<AgentRunValidator>(
    ({ threadState }) => {
      return threadState.agent.workspacePath ? null : copy.chat.inputNeedsWorkspace
    },
    [copy.chat.inputNeedsWorkspace]
  )
  const agent = useAgent({
    threadId,
    temporaryMode,
    validateRun
  })
  const {
    state: { pendingApproval },
    view: { canStop, error: visibleError, isBusy, isLoading },
    control: { clearError, invoke, resume, stop }
  } = agent
  const canInvoke =
    hasComposerMessageInputContent({ refs: [], text: input }) && !isBusy && !pendingApproval

  useEffect(() => {
    inputRef.current?.focus()
  }, [threadId])

  const invokeWithComposerRefs = useCallback(async (): Promise<boolean> => {
    const composer = inputRef.current
    const didInvoke = await invoke({
      refs: composer?.getRefs() ?? [],
      text: composer?.getModelText() ?? input
    })
    return didInvoke
  }, [input, invoke])
  const retry = useCallback(
    async (retryInput: ComposerMessageInput): Promise<void> => {
      await invoke(retryInput)
    },
    [invoke]
  )
  const setInput = useCallback(
    (value: string): void => {
      threadActions.setDraftInput(value)
    },
    [threadActions]
  )

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    await invokeWithComposerRefs()
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleCancel = async (): Promise<void> => {
    await stop()
  }

  const handleSelectWorkspaceFromEmptyState = useCallback(async (): Promise<void> => {
    setWorkspaceChangeError(null)
    await selectWorkspaceFolder(
      threadId,
      (path) => threadActions?.setWorkspacePath(path),
      () => {},
      undefined,
      {
        onBlockedByPendingWorkspaceMemory: () => {
          setWorkspaceChangeError(copy.chat.pendingWorkspaceMemoryBlocksWorkspaceChange)
        }
      }
    )
  }, [copy.chat.pendingWorkspaceMemoryBlocksWorkspaceChange, threadActions, threadId])

  return (
    <div className="chat-thread-surface flex min-h-0 flex-1 flex-col overflow-hidden">
      <ChatThreadViewport
        clearError={clearError}
        isBusy={isBusy}
        isLoading={isLoading}
        onRetry={retry}
        onSelectWorkspace={handleSelectWorkspaceFromEmptyState}
        pendingApproval={pendingApproval}
        threadId={threadId}
        visibleError={visibleError}
        workspaceChangeError={workspaceChangeError}
      />

      <div className="border-t border-border bg-background-elevated/60 px-[var(--ow-chat-thread-x)] py-[var(--ow-chat-footer-y)]">
        <form onSubmit={handleSubmit} className="mx-auto max-w-[var(--ow-chat-thread-max-width)]">
          <div className="flex flex-col gap-[var(--ow-gap-md)]">
            {pendingApproval ? (
              <ComposerApprovalPrompt
                key={pendingApproval.id}
                onDecision={(decision) => {
                  void resume(decision)
                }}
                request={pendingApproval}
              />
            ) : (
              <PromptInput
                className="px-[var(--ow-space-4)] py-[var(--ow-space-4)]"
                disabled={isBusy}
                isLoading={isBusy}
                maxHeight="200px"
                minHeight="var(--ow-chat-composer-input-min-h)"
                onSubmit={() => {
                  void invokeWithComposerRefs()
                }}
                onValueChange={setInput}
                value={input}
              >
                <div className="flex min-w-0 items-end gap-[var(--ow-gap-md)]">
                  <PromptInputTextarea
                    composerRef={inputRef}
                    mode="composer"
                    onKeyDown={handleKeyDown}
                    placeholder={copy.chat.messagePlaceholder}
                    sourceMentions={sourceMentions}
                    className="min-w-0 flex-1 resize-none bg-transparent px-0 py-0 [font-size:var(--ow-font-display)] text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
                  />
                  <div className="flex h-[var(--ow-chat-composer-action-h)] shrink-0 items-center justify-center">
                    {canStop ? (
                      <PromptInputAction
                        onClick={handleCancel}
                        icon={<Square className="size-[var(--ow-icon-action)]" />}
                        label={copy.launcher.aiStopLabel}
                        className="size-[var(--ow-control-h-md)] bg-background-elevated"
                      />
                    ) : (
                      <PromptInputAction
                        type="submit"
                        disabled={!canInvoke}
                        icon={<Send className="size-[var(--ow-icon-action)]" />}
                        label={copy.launcher.aiPrimaryLabel}
                        className="size-[var(--ow-control-h-md)] bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                      />
                    )}
                  </div>
                </div>
              </PromptInput>
            )}

            <div className="flex items-center justify-between gap-[var(--ow-gap-lg)]">
              <div className="flex items-center gap-[var(--ow-gap-sm)]">
                <ModelSwitcher threadId={threadId} />
                <div className="h-[var(--ow-control-divider-h)] w-px bg-border" />
                <WorkspacePicker threadId={threadId} />
                <button
                  type="button"
                  className={`inline-flex h-[var(--ow-control-h-md)] items-center gap-[var(--ow-space-1-5)] rounded-full border px-[var(--ow-space-2-5)] [font-size:var(--ow-font-meta)] transition ${
                    temporaryMode
                      ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
                      : "border-border bg-background-elevated text-muted-foreground hover:bg-background-secondary hover:text-foreground"
                  }`}
                  onClick={() => setTemporaryMode((current) => !current)}
                  aria-pressed={temporaryMode}
                >
                  {temporaryMode ? (
                    <Shield className="size-[var(--ow-icon-sm)]" />
                  ) : (
                    <Brain className="size-[var(--ow-icon-sm)]" />
                  )}
                  <span className="max-w-[var(--ow-chip-label-max-width)] truncate">
                    {temporaryMode ? copy.chat.memoryTemporaryOn : copy.chat.memoryTemporaryOff}
                  </span>
                </button>
              </div>
              {tokenUsage && currentModel && (
                <ContextUsageIndicator tokenUsage={tokenUsage} modelId={currentModel} />
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
