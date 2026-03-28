import { Bot, FileImage, User } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ContentBlock, HITLRequest, Message } from "@/types"
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

function resolveImageSource(content?: string): string | null {
  if (!content) {
    return null
  }

  if (
    content.startsWith("data:") ||
    content.startsWith("blob:") ||
    content.startsWith("http://") ||
    content.startsWith("https://") ||
    content.startsWith("file://")
  ) {
    return content
  }

  return null
}

function MessageImageBlock(props: {
  block: ContentBlock
  index: number
  isUser: boolean
}): React.JSX.Element {
  const { copy } = useI18n()
  const { block, index, isUser } = props
  const label = block.name || `${copy.launcher.clipboardImage} ${index + 1}`
  const src = resolveImageSource(block.content)

  return (
    <div className={cn("overflow-hidden rounded-[8px]", isUser && "bg-background-secondary/70")}>
      {src ? (
        <img
          alt={label}
          className="max-h-[320px] w-full object-cover object-center"
          loading="lazy"
          src={src}
        />
      ) : (
        <div className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-background">
            <FileImage className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{label}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function renderTextBlock(
  text: string,
  options: {
    isStreaming?: boolean
    isUser: boolean
    key: string
  }
): React.JSX.Element | null {
  const { isStreaming, isUser, key } = options

  if (!text.trim()) {
    return null
  }

  if (isUser) {
    return (
      <div key={key} className="whitespace-pre-wrap text-[15px] leading-7 [overflow-wrap:anywhere]">
        {text}
      </div>
    )
  }

  return (
    <StreamingMarkdown key={key} isStreaming={isStreaming}>
      {text}
    </StreamingMarkdown>
  )
}

function renderStructuredContent(
  content: Message["content"],
  options: {
    isStreaming?: boolean
    isUser: boolean
  }
): React.ReactNode {
  const { isStreaming, isUser } = options

  if (typeof content === "string") {
    return renderTextBlock(content, {
      isStreaming,
      isUser,
      key: "message-content"
    })
  }

  const lastTextBlockIndex = [...content]
    .reverse()
    .findIndex(
      (block) => block.type !== "image" && Boolean(block.text?.trim() || block.content?.trim())
    )
  const resolvedLastTextBlockIndex =
    lastTextBlockIndex === -1 ? -1 : content.length - lastTextBlockIndex - 1

  const renderedBlocks = content
    .map((block, index) => {
      if (block.type === "image") {
        return (
          <MessageImageBlock key={`image-${index}`} block={block} index={index} isUser={isUser} />
        )
      }

      const text = block.text ?? block.content ?? ""
      return renderTextBlock(text, {
        isStreaming: isStreaming && index === resolvedLastTextBlockIndex,
        isUser,
        key: `${block.type}-${index}`
      })
    })
    .filter(Boolean)

  return renderedBlocks.length > 0 ? renderedBlocks : null
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
  const content = renderStructuredContent(message.content, { isStreaming, isUser })
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
  const contentWidthClass = isUser ? "w-full max-w-[72%] self-end" : "w-full max-w-[78%]"
  const toolWidthClass = isUser ? "w-full max-w-[72%] self-end" : "w-full"

  // Don't render if there's no content and no tool calls
  if (!content && !hasToolCalls) {
    return null
  }

  return (
    <div
      className={cn("flex w-full min-w-0 flex-col space-y-3", isUser ? "items-end" : "items-start")}
    >
      <div className={cn("min-w-0", contentWidthClass)}>
        <div className={cn("flex items-center gap-2 text-section-header", isUser && "justify-end")}>
          {!isUser && (
            <span className="flex size-6 items-center justify-center rounded-full bg-background-secondary text-accent">
              {getIcon()}
            </span>
          )}
          <span>{getLabel()}</span>
          {isUser && (
            <span className="flex size-6 items-center justify-center rounded-full bg-[var(--chat-user-surface)] text-primary">
              {getIcon()}
            </span>
          )}
        </div>

        {content && (
          <div
            className={cn(
              "mt-3 min-w-0 overflow-hidden rounded-[8px] px-5 py-4 text-[15px] leading-8",
              isUser ? "bg-[var(--chat-user-surface)] text-foreground " : "text-foreground"
            )}
          >
            <div className="space-y-4">{content}</div>
          </div>
        )}
      </div>

      {hasToolCalls && (
        <div className={cn("min-w-0 space-y-3 overflow-hidden", toolWidthClass)}>
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
  )
}
