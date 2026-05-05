import { useRef, useEffect, useCallback } from "react"
import { Send, Square, Loader2, AlertCircle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useHistoryShellStore } from "@/lib/history-shell-store"
import { useThreadActions, useThreadSelector } from "@/lib/thread-context"
import { useAiInvocation } from "@/lib/ai-invocation"
import { Messages } from "./Messages"
import { ModelSwitcher } from "./ModelSwitcher"
import { Folder } from "lucide-react"
import { WorkspacePicker } from "./WorkspacePicker"
import { selectWorkspaceFolder } from "@/lib/workspace-utils"
import { ChatTodos } from "./ChatTodos"
import { ComposerApprovalPrompt } from "./ComposerApprovalPrompt"
import { ContextUsageIndicator } from "./ContextUsageIndicator"
import { useI18n } from "@/lib/i18n"
import { useDisableTabNavigation } from "@/lib/use-disable-tab-navigation"
import { maybeGenerateThreadTitle } from "@/lib/thread-title"

interface ChatContainerProps {
  threadId: string
}

const EMPTY_TOKEN_USAGE = null

export function ChatContainer({ threadId }: ChatContainerProps): React.JSX.Element {
  const { copy } = useI18n()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  useDisableTabNavigation(inputRef)

  const threads = useHistoryShellStore((state) => state.threads)
  const updateThread = useHistoryShellStore((state) => state.updateThread)

  const threadActions = useThreadActions(threadId)
  const workspacePath = useThreadSelector(threadId, (state) => state?.workspacePath ?? null)
  const tokenUsage = useThreadSelector(threadId, (state) => state?.tokenUsage ?? EMPTY_TOKEN_USAGE)
  const currentModel = useThreadSelector(threadId, (state) => state?.currentModel ?? null)
  const invocation = useAiInvocation({
    onAfterAppendMessage: ({ isFirstMessage, message }) => {
      if (!isFirstMessage) {
        return
      }

      const currentThread = threads.find((thread) => thread.thread_id === threadId)
      void maybeGenerateThreadTitle(threadId, message, {
        persistTitle: async (nextThreadId, title) => {
          await updateThread(nextThreadId, { title })
        },
        thread: currentThread
      })
    },
    threadId,
    validateInvocation: ({ threadState }) => {
      return threadState.workspacePath ? null : copy.chat.inputNeedsWorkspace
    }
  })
  const {
    clearVisibleError,
    conversation: { displayMessages, isLoading, pendingApproval, todos },
    input,
    invoke,
    isBusy,
    retry,
    resume,
    setInput,
    stop,
    visibleError
  } = invocation

  // Get the actual scrollable viewport element from Radix ScrollArea
  const getViewport = useCallback((): HTMLDivElement | null => {
    return scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLDivElement | null
  }, [])

  // Track scroll position to determine if user is at bottom
  const handleScroll = useCallback((): void => {
    const viewport = getViewport()
    if (!viewport) return

    const { scrollTop, scrollHeight, clientHeight } = viewport
    // Consider "at bottom" if within 50px of the bottom
    const threshold = 50
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < threshold
  }, [getViewport])

  // Attach scroll listener to viewport
  useEffect(() => {
    const viewport = getViewport()
    if (!viewport) return

    viewport.addEventListener("scroll", handleScroll)
    return () => viewport.removeEventListener("scroll", handleScroll)
  }, [getViewport, handleScroll])

  // Auto-scroll on new messages only if already at bottom
  useEffect(() => {
    const viewport = getViewport()
    if (viewport && isAtBottomRef.current) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [displayMessages, isBusy, getViewport])

  // Always scroll to bottom when switching threads
  useEffect(() => {
    const viewport = getViewport()
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
      isAtBottomRef.current = true
    }
  }, [threadId, getViewport])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [threadId])

  const handleDismissError = (): void => {
    clearVisibleError()
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    await invoke()
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  // Auto-resize textarea based on content
  const adjustTextareaHeight = (): void => {
    const textarea = inputRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }

  useEffect(() => {
    adjustTextareaHeight()
  }, [input])

  const handleCancel = async (): Promise<void> => {
    await stop()
  }

  const handleSelectWorkspaceFromEmptyState = async (): Promise<void> => {
    await selectWorkspaceFolder(
      threadId,
      (path) => threadActions?.setWorkspacePath(path),
      () => {},
      undefined
    )
  }

  return (
    <div className="chat-thread-surface flex min-h-0 flex-1 flex-col overflow-hidden">
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="px-[var(--ow-chat-thread-x)] py-[var(--ow-chat-thread-y)]">
          <div className="mx-auto max-w-[var(--ow-chat-thread-max-width)] space-y-[var(--ow-chat-thread-gap)]">
            {displayMessages.length === 0 && !isLoading && (
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
                  </div>
                )}
              </div>
            )}

            <Messages
              approvalPlacement="composer"
              isLoading={isLoading}
              messages={displayMessages}
              onApprovalDecision={resume}
              onRetry={retry}
              pendingApproval={pendingApproval}
            />

            {!isLoading && todos.length > 0 && (pendingApproval || displayMessages.length > 0) && (
              <ChatTodos todos={todos} />
            )}

            {/* Streaming indicator and inline TODOs */}
            {isBusy && (
              <div className="space-y-[var(--ow-space-4)] border-t border-border pt-[var(--ow-space-4)]">
                <div className="flex items-center gap-[var(--ow-gap-sm)] [font-size:var(--ow-font-body)] text-muted-foreground">
                  <Loader2 className="size-[var(--ow-icon-action)] animate-spin" />
                  {copy.chat.agentThinking}
                </div>
                {todos.length > 0 && <ChatTodos todos={todos} />}
              </div>
            )}

            {/* Error state */}
            {visibleError && !isBusy && (
              <div className="flex items-start gap-[var(--ow-gap-md)] border-l-[3px] border-destructive bg-destructive/8 px-[var(--ow-space-4)] py-[var(--ow-space-3)]">
                <AlertCircle className="size-[var(--ow-icon-md)] text-destructive shrink-0 mt-[var(--ow-leading-nudge)]" />
                <div className="flex-1 min-w-0">
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
                  className="shrink-0 rounded p-[var(--ow-space-1)] hover:bg-destructive/20 transition-colors"
                  aria-label={copy.chat.dismissError}
                >
                  <X className="size-[var(--ow-icon-action)] text-muted-foreground" />
                </button>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

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
              <div className="flex items-end gap-[var(--ow-gap-md)] rounded-[var(--ow-chat-composer-radius)] bg-background-secondary px-[var(--ow-space-4)] py-[var(--ow-space-4)]">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={copy.chat.messagePlaceholder}
                  disabled={isBusy}
                  className="min-w-0 flex-1 resize-none bg-transparent px-0 py-0 [font-size:var(--ow-font-display)] leading-[var(--ow-line-reading)] text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
                  rows={1}
                  style={{ minHeight: "var(--ow-chat-composer-input-min-h)", maxHeight: "200px" }}
                />
                <div className="flex h-[var(--ow-chat-composer-action-h)] shrink-0 items-center justify-center">
                  {isBusy ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleCancel}
                      className="rounded-full bg-background-elevated"
                    >
                      <Square className="size-[var(--ow-icon-action)]" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      variant="default"
                      size="icon"
                      disabled={!invocation.canInvoke}
                      className="rounded-full"
                    >
                      <Send className="size-[var(--ow-icon-action)]" />
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-[var(--ow-gap-lg)]">
              <div className="flex items-center gap-[var(--ow-gap-sm)]">
                <ModelSwitcher threadId={threadId} />
                <div className="h-[var(--ow-control-divider-h)] w-px bg-border" />
                <WorkspacePicker threadId={threadId} />
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
