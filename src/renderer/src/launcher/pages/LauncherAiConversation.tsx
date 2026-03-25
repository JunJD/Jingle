import { AlertCircle, ArrowDown, Loader2, X } from "lucide-react"
import { MessageBubble } from "@/components/chat/MessageBubble"
import { ChatTodos } from "@/components/chat/ChatTodos"
import type { HITLRequest, Message, Todo } from "@/types"
import { useI18n } from "@/lib/i18n"
import { StickToBottom } from "use-stick-to-bottom"

interface ToolResultInfo {
  content: string | unknown
  is_error?: boolean
}

export function LauncherAiEmptyState(props: { error?: string | null }): React.JSX.Element {
  const { copy } = useI18n()
  const { error } = props

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-8">
      <div className="relative flex max-w-2xl flex-col items-center text-center">
        <div className="text-section-header mb-3">{copy.launcher.aiEmptyEyebrow}</div>
        <h1 className="text-[44px] font-semibold tracking-[-0.05em] text-foreground">
          {copy.launcher.aiHeroTitle}
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
          {copy.launcher.aiHeroDescription}
        </p>
        {error ? (
          <div className="mt-8 flex w-full items-start gap-3 border-l-[3px] border-destructive bg-destructive/8 px-4 py-3 text-left">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-destructive">{copy.chat.agentError}</div>
              <div className="mt-1 break-words text-sm text-muted-foreground">{error}</div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function LauncherAiConversation(props: {
  clearError: () => void
  displayMessages: Message[]
  error: string | null
  isLoading: boolean
  onApprovalDecision: (decision: "approve" | "reject" | "edit") => Promise<void>
  pendingApproval: HITLRequest | null
  todos: Todo[]
  toolResults: Map<string, ToolResultInfo>
}): React.JSX.Element {
  const { copy } = useI18n()
  const {
    clearError,
    displayMessages,
    error,
    isLoading,
    onApprovalDecision,
    pendingApproval,
    todos,
    toolResults
  } = props

  if (!displayMessages.length && !isLoading && !error) {
    return <LauncherAiEmptyState />
  }

  return (
    <StickToBottom className="relative min-h-0 flex-1" initial="instant" resize="smooth">
      {({ isAtBottom, scrollToBottom }) => (
        <>
          <StickToBottom.Content className="px-6 py-6" scrollClassName="h-full">
            <div className="mx-auto flex max-w-4xl flex-col gap-8">
              {displayMessages.map((message, index) => (
                <MessageBubble
                  key={message.id}
                  isStreaming={
                    isLoading && index === displayMessages.length - 1 && message.role !== "user"
                  }
                  message={message}
                  onApprovalDecision={onApprovalDecision}
                  pendingApproval={pendingApproval}
                  toolResults={toolResults}
                />
              ))}

              {!isLoading &&
                todos.length > 0 &&
                (pendingApproval || displayMessages.length > 0) && <ChatTodos todos={todos} />}

              {isLoading && (
                <div className="space-y-4 border-t border-border pt-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
                    <div className="text-sm font-medium text-destructive">
                      {copy.chat.agentError}
                    </div>
                    <div className="mt-1 break-words text-sm text-muted-foreground">{error}</div>
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
          </StickToBottom.Content>

          {!isAtBottom && (
            <button
              type="button"
              className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background-secondary px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition"
              style={{
                borderColor: "var(--launcher-border-strong)"
              }}
              onClick={() => void scrollToBottom({ animation: "smooth" })}
            >
              <ArrowDown className="size-3.5" />
              {copy.launcher.jumpToLatest}
            </button>
          )}
        </>
      )}
    </StickToBottom>
  )
}
