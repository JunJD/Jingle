import { useRef, useEffect, useCallback } from "react"
import { Send, Square, Loader2, AlertCircle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAppStore } from "@/lib/store"
import { useCurrentThread } from "@/lib/thread-context"
import { useThreadConversationProjection } from "@/lib/thread-conversation"
import { MessageBubble } from "./MessageBubble"
import { ModelSwitcher } from "./ModelSwitcher"
import { Folder } from "lucide-react"
import { WorkspacePicker } from "./WorkspacePicker"
import { selectWorkspaceFolder } from "@/lib/workspace-utils"
import { ChatTodos } from "./ChatTodos"
import { ContextUsageIndicator } from "./ContextUsageIndicator"
import type { Message } from "@/types"
import { useI18n } from "@/lib/i18n"
import { useDisableTabNavigation } from "@/lib/use-disable-tab-navigation"
import { isDefaultThreadTitle } from "../../../../shared/i18n"

interface ChatContainerProps {
  threadId: string
}

export function ChatContainer({ threadId }: ChatContainerProps): React.JSX.Element {
  const { copy } = useI18n()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  useDisableTabNavigation(inputRef)

  const { threads, loadThreads, generateTitleForFirstMessage } = useAppStore()

  const {
    messages,
    pendingApproval,
    workspacePath,
    tokenUsage,
    currentModel,
    draftInput: input,
    setWorkspaceFiles,
    setWorkspacePath,
    setPendingApproval,
    appendMessage,
    clearError,
    setError,
    setDraftInput: setInput
  } = useCurrentThread(threadId)
  const {
    displayMessages,
    error: threadError,
    isLoading,
    resumePendingApproval,
    stream,
    todos,
    toolResults
  } = useThreadConversationProjection(threadId, {
    onMessagesPersisted: loadThreads
  })

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
  }, [displayMessages, isLoading, getViewport])

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
    clearError()
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!input.trim() || isLoading || !stream) return

    if (!workspacePath) {
      setError(copy.chat.inputNeedsWorkspace)
      return
    }

    if (threadError) {
      clearError()
    }

    if (pendingApproval) {
      setPendingApproval(null)
    }

    const message = input.trim()
    setInput("")

    const isFirstMessage = messages.length === 0

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      created_at: new Date()
    }
    appendMessage(userMessage)

    if (isFirstMessage) {
      const currentThread = threads.find((t) => t.thread_id === threadId)
      const hasDefaultTitle = isDefaultThreadTitle(currentThread?.title)
      if (hasDefaultTitle) {
        generateTitleForFirstMessage(threadId, message)
      }
    }

    await stream.submit(
      {
        messages: [{ type: "human", content: message }]
      },
      {
        config: {
          configurable: { thread_id: threadId, model_id: currentModel }
        }
      }
    )
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
    await stream?.stop()
  }

  const handleSelectWorkspaceFromEmptyState = async (): Promise<void> => {
    await selectWorkspaceFolder(threadId, setWorkspacePath, setWorkspaceFiles, () => {}, undefined)
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="px-8 py-7">
          <div className="mx-auto max-w-4xl space-y-8">
            {displayMessages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
                <div className="mb-3 text-section-header">{copy.chat.newThreadEyebrow}</div>
                {workspacePath ? (
                  <div className="text-center">
                    <div className="text-[28px] font-semibold tracking-[-0.04em] text-foreground">
                      {copy.chat.startConversation}
                    </div>
                    <div className="mt-3 text-sm text-muted-foreground">
                      {copy.chat.describeOutcome}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 text-center text-sm">
                    <div>
                      <span className="text-status-warning">{copy.chat.selectWorkspaceTitle}</span>
                      <span className="block text-xs mt-1 opacity-75">
                        {copy.chat.selectWorkspaceHint}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-background-secondary px-3 text-xs text-status-warning transition-colors duration-100 hover:bg-background-interactive disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={handleSelectWorkspaceFromEmptyState}
                    >
                      <Folder className="size-3.5" />
                      <span className="max-w-[120px] truncate">{copy.chat.selectWorkspace}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {displayMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                toolResults={toolResults}
                pendingApproval={pendingApproval}
                onApprovalDecision={resumePendingApproval}
              />
            ))}

            {!isLoading && todos.length > 0 && (pendingApproval || displayMessages.length > 0) && (
              <ChatTodos todos={todos} />
            )}

            {/* Streaming indicator and inline TODOs */}
            {isLoading && (
              <div className="space-y-4 border-t border-border pt-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {copy.chat.agentThinking}
                </div>
                {todos.length > 0 && <ChatTodos todos={todos} />}
              </div>
            )}

            {/* Error state */}
            {threadError && !isLoading && (
              <div className="flex items-start gap-3 border-l-[3px] border-destructive bg-destructive/8 px-4 py-3">
                <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-destructive text-sm">{copy.chat.agentError}</div>
                  <div className="text-sm text-muted-foreground mt-1 break-words">
                    {threadError}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    {copy.chat.agentErrorRecovery}
                  </div>
                </div>
                <button
                  onClick={handleDismissError}
                  className="shrink-0 rounded p-1 hover:bg-destructive/20 transition-colors"
                  aria-label={copy.chat.dismissError}
                >
                  <X className="size-4 text-muted-foreground" />
                </button>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      <div className="border-t border-border bg-background-elevated/60 px-8 py-5">
        <form onSubmit={handleSubmit} className="mx-auto max-w-4xl">
          <div className="flex flex-col gap-3">
            <div className="flex items-end gap-3 rounded-[20px] bg-background-secondary px-4 py-4">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={copy.chat.messagePlaceholder}
                disabled={isLoading}
                className="flex-1 min-w-0 resize-none bg-transparent px-0 py-0 text-[15px] leading-7 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
                rows={1}
                style={{ minHeight: "48px", maxHeight: "200px" }}
              />
              <div className="flex h-12 shrink-0 items-center justify-center">
                {isLoading ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleCancel}
                    className="rounded-full bg-background-elevated"
                  >
                    <Square className="size-4" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    variant="default"
                    size="icon"
                    disabled={!input.trim()}
                    className="rounded-full"
                  >
                    <Send className="size-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <ModelSwitcher threadId={threadId} />
                <div className="h-4 w-px bg-border" />
                <WorkspacePicker threadId={threadId} />
              </div>
              {tokenUsage && (
                <ContextUsageIndicator tokenUsage={tokenUsage} modelId={currentModel} />
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
