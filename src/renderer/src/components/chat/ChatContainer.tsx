import { useRef, useEffect, useCallback, useMemo, useState } from "react"
import { AlertCircle, Brain, Folder, Send, Shield, Square, X } from "lucide-react"
import type { VListHandle } from "virtua"
import {
  PromptInput,
  PromptInputAction,
  PromptInputTextarea,
  ThinkingBar
} from "@/components/agent-ui"
import { useThreadActions, useThreadSelector } from "@/lib/thread-context"
import { useAiInvocation } from "@/lib/ai-invocation"
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

interface ChatContainerProps {
  threadId: string
}

const EMPTY_TOKEN_USAGE = null

export function ChatContainer({ threadId }: ChatContainerProps): React.JSX.Element {
  const { copy } = useI18n()
  const sourceMentions = useMemo(
    () => listNativeExtensionSourceMentions(window.electron.process.platform),
    []
  )
  const inputRef = useRef<ComposerAreaHandle>(null)
  const virtualizerRef = useRef<VListHandle>(null)
  const [temporaryMode, setTemporaryMode] = useState(false)
  const [workspaceChangeError, setWorkspaceChangeError] = useState<string | null>(null)
  useDisableTabNavigation(inputRef)

  const threadActions = useThreadActions(threadId)
  const workspacePath = useThreadSelector(threadId, (state) => state?.workspacePath ?? null)
  const tokenUsage = useThreadSelector(threadId, (state) => state?.tokenUsage ?? EMPTY_TOKEN_USAGE)
  const runId = useThreadSelector(threadId, (state) => state?.runId ?? null)
  const currentModel = useThreadSelector(threadId, (state) => state?.currentModel ?? null)
  const invocation = useAiInvocation({
    threadId,
    temporaryMode,
    validateInvocation: ({ threadState }) => {
      return threadState.workspacePath ? null : copy.chat.inputNeedsWorkspace
    }
  })
  const {
    clearVisibleError,
    conversation: { isLoading, messageProjection, pendingApproval, todos },
    input,
    invoke,
    isBusy,
    retry,
    resume,
    setInput,
    stop,
    visibleError
  } = invocation
  const hasVisibleTurns = messageProjection.turns.length > 0
  const showEmptyChat = !hasVisibleTurns && !isLoading && !visibleError
  const chatVirtualItemCount = showEmptyChat ? 0 : messageProjection.displayRows.length

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

  useEffect(() => {
    inputRef.current?.focus()
  }, [threadId])

  const handleDismissError = (): void => {
    clearVisibleError()
  }

  const invokeWithComposerRefs = useCallback(async (): Promise<boolean> => {
    const composer = inputRef.current
    const didInvoke = await invoke({
      refs: composer?.getRefs() ?? [],
      text: composer?.getModelText() ?? input
    })
    return didInvoke
  }, [input, invoke])

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

  const handleSelectWorkspaceFromEmptyState = async (): Promise<void> => {
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
  }

  return (
    <div className="chat-thread-surface flex min-h-0 flex-1 flex-col overflow-hidden">
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
                      onClick={handleSelectWorkspaceFromEmptyState}
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
            density="compact"
            footerSlot={
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
                      onClick={handleDismissError}
                      className="shrink-0 rounded p-[var(--ow-space-1)] transition-colors hover:bg-destructive/20"
                      aria-label={copy.chat.dismissError}
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
            onRetry={retry}
            onScroll={handleChatScroll}
            onScrollEnd={handleChatScrollEnd}
            onScrollToLatest={scrollToLatest}
            onUserScrollIntent={markUserScrollIntent}
            pendingApproval={pendingApproval}
            projection={messageProjection}
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

      <div className="border-t border-border bg-background-elevated/60 px-[var(--ow-chat-thread-x)] py-[var(--ow-chat-footer-y)]">
        <form onSubmit={handleSubmit} className="mx-auto max-w-[var(--ow-chat-thread-max-width)]">
          <div className="flex flex-col gap-[var(--ow-gap-md)]">
            {isBusy ? <ThinkingBar text={copy.chat.agentThinking} /> : null}

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
                    {isBusy ? (
                      <PromptInputAction
                        onClick={handleCancel}
                        icon={<Square className="size-[var(--ow-icon-action)]" />}
                        label={copy.launcher.aiStopLabel}
                        className="size-[var(--ow-control-h-md)] bg-background-elevated"
                      />
                    ) : (
                      <PromptInputAction
                        type="submit"
                        disabled={!invocation.canInvoke}
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
