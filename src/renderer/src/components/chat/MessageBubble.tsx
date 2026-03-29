import { Bot, FileText, User } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ContentBlock, HITLRequest, Message } from "@/types"
import { ToolCallRenderer } from "./ToolCallRenderer"
import { StreamingMarkdown } from "./StreamingMarkdown"
import { useI18n } from "@/lib/i18n"
import { resolveImageBlockUrl } from "../../../../shared/message-content"
import {
  Attachment,
  Attachments,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentHoverPreview,
  AttachmentPreview,
  type AttachmentData
} from "../ui/attachments"

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

interface StructuredMessageContent {
  attachments: React.ReactNode
  textContent: React.ReactNode
}

function isRenderableImageUrl(url: string | null): url is string {
  return Boolean(
    url &&
    (url.startsWith("data:") ||
      url.startsWith("blob:") ||
      url.startsWith("http://") ||
      url.startsWith("https://") ||
      url.startsWith("file://"))
  )
}

function toAttachmentData(
  block: ContentBlock,
  index: number,
  clipboardImageLabel: string
): {
  data: AttachmentData
  fallbackIcon?: React.JSX.Element
} | null {
  if (block.type === "image" || block.type === "image_url") {
    const url = resolveImageBlockUrl(block)
    return {
      data: {
        filename: block.name || `${clipboardImageLabel} ${index + 1}`,
        id: `attachment:${index}`,
        mediaType: block.mimeType || "image/png",
        type: "file",
        ...(isRenderableImageUrl(url) ? { url } : {})
      }
    }
  }

  if (block.type === "file") {
    return {
      data: {
        filename: block.name || "Attachment",
        id: `attachment:${index}`,
        mediaType: block.mimeType,
        type: "file",
        ...(block.content?.startsWith("http://") || block.content?.startsWith("https://")
          ? { url: block.content }
          : {})
      },
      fallbackIcon: <FileText className="size-7 text-muted-foreground" />
    }
  }

  return null
}

function MessageAttachments(props: {
  blocks: Array<{ block: ContentBlock; index: number }>
  isUser: boolean
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { blocks, isUser } = props
  const attachments = blocks
    .map(({ block, index }) => toAttachmentData(block, index, copy.launcher.clipboardImage))
    .filter((item): item is NonNullable<ReturnType<typeof toAttachmentData>> => item !== null)

  if (attachments.length === 0) {
    return null
  }

  return (
    <Attachments
      variant="grid"
      className={cn(
        "w-fit max-w-full gap-3",
        isUser ? "ml-auto justify-end" : "mr-auto justify-start"
      )}
    >
      {attachments.map(({ data, fallbackIcon }) => (
        <AttachmentHoverCard key={data.id}>
          <AttachmentHoverCardTrigger asChild>
            <Attachment
              data={data}
              className={cn(
                "size-28 overflow-hidden rounded-[20px] border-0 bg-background-secondary shadow-[0_8px_24px_rgba(0,0,0,0.14)]",
                "sm:size-32"
              )}
            >
              <AttachmentPreview
                fallbackIcon={fallbackIcon}
                className={cn(
                  "size-full bg-background-secondary",
                  fallbackIcon ? "p-0" : "object-cover"
                )}
              />
            </Attachment>
          </AttachmentHoverCardTrigger>
          <AttachmentHoverCardContent>
            <AttachmentHoverPreview data={data} fallbackIcon={fallbackIcon} showMediaType={false} />
          </AttachmentHoverCardContent>
        </AttachmentHoverCard>
      ))}
    </Attachments>
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
): StructuredMessageContent {
  const { isStreaming, isUser } = options

  if (typeof content === "string") {
    return {
      attachments: null,
      textContent: renderTextBlock(content, {
        isStreaming,
        isUser,
        key: "message-content"
      })
    }
  }

  const attachmentBlocks = content
    .map((block, index) => ({ block, index }))
    .filter(
      ({ block }) => block.type === "image" || block.type === "image_url" || block.type === "file"
    )

  const lastTextBlockIndex = [...content]
    .reverse()
    .findIndex(
      (block) =>
        block.type !== "image" &&
        block.type !== "image_url" &&
        block.type !== "file" &&
        Boolean(block.text?.trim() || block.content?.trim())
    )
  const resolvedLastTextBlockIndex =
    lastTextBlockIndex === -1 ? -1 : content.length - lastTextBlockIndex - 1

  const textBlocks = content
    .map((block, index) => {
      if (block.type === "image" || block.type === "image_url" || block.type === "file") {
        return null
      }

      const text = block.text ?? block.content ?? ""
      return renderTextBlock(text, {
        isStreaming: isStreaming && index === resolvedLastTextBlockIndex,
        isUser,
        key: `${block.type}-${index}`
      })
    })
    .filter(Boolean)

  return {
    attachments: <MessageAttachments blocks={attachmentBlocks} isUser={isUser} />,
    textContent: textBlocks.length > 0 ? textBlocks : null
  }
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
  if (!content.attachments && !content.textContent && !hasToolCalls) {
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

        <div className="mt-3 min-w-0 space-y-4">
          {content.attachments}
          {content.textContent ? (
            <div
              className={cn(
                "min-w-0 overflow-hidden rounded-[8px] px-5 py-4 text-[15px] leading-8",
                isUser ? "bg-[var(--chat-user-surface)] text-foreground" : "text-foreground"
              )}
            >
              <div className="space-y-4">{content.textContent}</div>
            </div>
          ) : null}
        </div>
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
