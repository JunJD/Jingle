import { AlertCircle, ArrowDown, Loader2, X } from "lucide-react"
import { MessageBubble } from "@/components/chat/MessageBubble"
import { ChatTodos } from "@/components/chat/ChatTodos"
import type { HITLRequest, Message, Todo } from "@/types"
import { StickToBottom } from "use-stick-to-bottom"

interface ToolResultInfo {
  content: string | unknown
  is_error?: boolean
}

export function LauncherAiEmptyState(props: { error?: string | null }): React.JSX.Element {
  const { error } = props

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 44%, color-mix(in srgb, var(--primary) 8%, transparent), transparent 58%)"
        }}
      />
      <div className="relative flex max-w-xl flex-col items-center text-center">
        <h1 className="text-[48px] font-semibold tracking-[-0.04em] text-foreground">
          Ask Anything
        </h1>
        {error ? (
          <div className="mt-6 flex w-full items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-left">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-destructive">Agent Error</div>
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
          <StickToBottom.Content className="px-6 py-5" scrollClassName="h-full">
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
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
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Agent is thinking...
                  </div>
                  {todos.length > 0 && <ChatTodos todos={todos} />}
                </div>
              )}

              {error && !isLoading && (
                <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4">
                  <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-destructive">Agent Error</div>
                    <div className="mt-1 break-words text-sm text-muted-foreground">{error}</div>
                  </div>
                  <button
                    aria-label="Dismiss error"
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
              className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition"
              style={{
                borderColor: "var(--launcher-border-strong)",
                backgroundColor: "color-mix(in srgb, var(--launcher-surface) 90%, transparent)",
                color: "var(--launcher-text)"
              }}
              onClick={() => void scrollToBottom({ animation: "smooth" })}
            >
              <ArrowDown className="size-3.5" />
              Jump to latest
            </button>
          )}
        </>
      )}
    </StickToBottom>
  )
}
