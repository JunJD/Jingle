import { useRef, useEffect, useCallback } from "react"
import { Send, Square, AlertCircle, Folder, X } from "lucide-react"
import {
  PromptInput,
  PromptInputAction,
  PromptInputTextarea,
  ThinkingBar
} from "@/components/agent-ui"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useThreadActions, useThreadSelector } from "@/lib/thread-context"
import { useAiInvocation } from "@/lib/ai-invocation"
import { Messages } from "./Messages"
import { ModelSwitcher } from "./ModelSwitcher"
import { WorkspacePicker } from "./WorkspacePicker"
import { selectWorkspaceFolder } from "@/lib/workspace-utils"
import { ChatTodos } from "./ChatTodos"
import { ComposerApprovalPrompt } from "./ComposerApprovalPrompt"
import { ContextUsageIndicator } from "./ContextUsageIndicator"
import { useI18n } from "@/lib/i18n"
import { useDisableTabNavigation } from "@/lib/use-disable-tab-navigation"

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

  const threadActions = useThreadActions(threadId)
  const workspacePath = useThreadSelector(threadId, (state) => state?.workspacePath ?? null)
  const tokenUsage = useThreadSelector(threadId, (state) => state?.tokenUsage ?? EMPTY_TOKEN_USAGE)
  const currentModel = useThreadSelector(threadId, (state) => state?.currentModel ?? null)
  const invocation = useAiInvocation({
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

  const getViewport = useCallback((): HTMLDivElement | null => {
    return scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLDivElement | null
  }, [])

  const handleScroll = useCallback((): void => {
    const viewport = getViewport()
    if (!viewport) return

    const { scrollTop, scrollHeight, clientHeight } = viewport
    const threshold = 50
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < threshold
  }, [getViewport])

  useEffect(() => {
    const viewport = getViewport()
    if (!viewport) return

    viewport.addEventListener("scroll", handleScroll)
    return () => viewport.removeEventListener("scroll", handleScroll)
  }, [getViewport, handleScroll])

  useEffect(() => {
    const viewport = getViewport()
    if (viewport && isAtBottomRef.current) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [displayMessages, isBusy, getViewport])

  useEffect(() => {
    const viewport = getViewport()
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
      isAtBottomRef.current = true
    }
  }, [threadId, getViewport])

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
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

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

            {isBusy && todos.length > 0 && <ChatTodos todos={todos} />}

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
                  void invoke()
                }}
                onValueChange={setInput}
                textareaRef={inputRef}
                value={input}
              >
                <div className="flex min-w-0 items-end gap-[var(--ow-gap-md)]">
                  <PromptInputTextarea
                    ref={inputRef}
                    onKeyDown={handleKeyDown}
                    placeholder={copy.chat.messagePlaceholder}
                    className="min-w-0 flex-1 resize-none bg-transparent px-0 py-0 [font-size:var(--ow-font-display)] leading-[var(--ow-line-reading)] text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
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
