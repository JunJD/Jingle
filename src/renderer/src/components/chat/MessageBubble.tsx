import { User, Bot } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Message, HITLRequest } from "@/types"
import { ToolCallRenderer } from "./ToolCallRenderer"
import { StreamingMarkdown } from "./StreamingMarkdown"
import { useI18n } from "@/lib/i18n"

interface ToolResultInfo {
  content: string | unknown
  is_error?: boolean
}

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
  toolResults?: Map<string, ToolResultInfo>
  pendingApproval?: HITLRequest | null
  onApprovalDecision?: (decision: "approve" | "reject" | "edit") => void
}

export function MessageBubble({
  message,
  isStreaming,
  toolResults,
  pendingApproval,
  onApprovalDecision
}: MessageBubbleProps): React.JSX.Element | null {
  const { copy } = useI18n()
  const isUser = message.role === "user"
  const isTool = message.role === "tool"

  // Hide tool result messages - they're shown inline with tool calls
  if (isTool) {
    return null
  }

  const getIcon = (): React.JSX.Element => {
    if (isUser) return <User className="size-4" />
    return <Bot className="size-4" />
  }

  const getLabel = (): string => {
    if (isUser) return copy.chat.userLabel
    return copy.chat.agentLabel
  }

  const renderContent = (): React.ReactNode => {
    if (typeof message.content === "string") {
      // Empty content
      if (!message.content.trim()) {
        return null
      }

      // Use streaming markdown for assistant messages, plain text for user messages
      if (isUser) {
        return <div className="whitespace-pre-wrap text-sm">{message.content}</div>
      }
      return <StreamingMarkdown isStreaming={isStreaming}>{message.content}</StreamingMarkdown>
    }

    // Handle content blocks
    const renderedBlocks = message.content
      .map((block, index) => {
        if (block.type === "text" && block.text) {
          // Use streaming markdown for assistant text blocks
          if (isUser) {
            return (
              <div key={index} className="whitespace-pre-wrap text-sm">
                {block.text}
              </div>
            )
          }
          return (
            <StreamingMarkdown key={index} isStreaming={isStreaming}>
              {block.text}
            </StreamingMarkdown>
          )
        }
        return null
      })
      .filter(Boolean)

    return renderedBlocks.length > 0 ? renderedBlocks : null
  }

  const content = renderContent()
  const hasToolCalls = message.tool_calls && message.tool_calls.length > 0

  const getPendingMatchIndex = (): number => {
    if (!hasToolCalls || !pendingApproval) {
      return -1
    }

    const pendingId = pendingApproval.tool_call?.id
    if (!pendingId) {
      return -1
    }

    return message.tool_calls!.findIndex((toolCall) => toolCall.id === pendingId)
  }

  const pendingMatchIndex = getPendingMatchIndex()

  // Don't render if there's no content and no tool calls
  if (!content && !hasToolCalls) {
    return null
  }

  return (
    <div className={cn("flex overflow-hidden", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("min-w-0 space-y-3", isUser ? "max-w-[72%]" : "max-w-[78%]")}>
        <div className={cn("flex items-center gap-2 text-section-header", isUser && "justify-end")}>
          {!isUser && <span className="text-accent">{getIcon()}</span>}
          <span>{getLabel()}</span>
          {isUser && <span className="text-primary">{getIcon()}</span>}
        </div>

        {content && (
          <div
            className={cn(
              "overflow-hidden text-[15px] leading-8",
              isUser
                ? "rounded-[20px] bg-[var(--chat-user-surface)] px-5 py-4 shadow-[inset_0_0_0_1px_var(--chat-user-line)]"
                : "text-foreground"
            )}
          >
            {content}
          </div>
        )}

        {hasToolCalls && (
          <div className="space-y-3 overflow-hidden">
            {message.tool_calls!.map((toolCall, index) => {
              const result = toolResults?.get(toolCall.id)
              const needsApproval = pendingMatchIndex === index
              return (
                <ToolCallRenderer
                  key={`${toolCall.id || `tc-${index}`}-${needsApproval ? "pending" : "done"}`}
                  toolCall={toolCall}
                  result={result?.content}
                  isError={result?.is_error}
                  needsApproval={needsApproval}
                  onApprovalDecision={needsApproval ? onApprovalDecision : undefined}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
