import { CopyIcon, FileText, RefreshCcwIcon } from "lucide-react"
import { useMemo } from "react"
import { extractMessageText, resolveImageBlockUrl } from "../../../../shared/message-content"
import type { ContentBlock, HITLRequest, Message as ThreadMessage } from "@/types"
import { ToolCallRenderer } from "./ToolCallRenderer"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
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
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
  MessageToolbar
} from "./message"

interface ToolResultInfo {
  content: string | unknown
  is_error?: boolean
}

interface MessagesProps {
  messages: ThreadMessage[]
  isLoading?: boolean
  pendingApproval?: HITLRequest | null
  onApprovalDecision?: (decision: "approve" | "reject" | "edit") => void
  onRetry?: () => Promise<void> | void
}

interface StructuredMessageContent {
  attachments: React.ReactNode
  textContent: React.ReactNode
}

function buildToolResults(messages: ThreadMessage[]): Map<string, ToolResultInfo> {
  const results = new Map<string, ToolResultInfo>()

  for (const message of messages) {
    if (message.role !== "tool" || !message.tool_call_id) {
      continue
    }

    results.set(message.tool_call_id, {
      content: message.content,
      is_error: false
    })
  }

  return results
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
      className={cn("w-fit max-w-full gap-3", isUser ? "ml-auto justify-end" : "justify-start")}
    >
      {attachments.map(({ data, fallbackIcon }) => (
        <AttachmentHoverCard key={data.id}>
          <AttachmentHoverCardTrigger asChild>
            <Attachment
              data={data}
              className={cn(
                "size-24 overflow-hidden rounded-[18px] border-0 bg-background-secondary shadow-[0_8px_24px_rgba(0,0,0,0.14)]",
                "sm:size-28"
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
    <MessageResponse key={key} className="min-w-0 text-[15px] leading-7" isAnimating={isStreaming}>
      {text}
    </MessageResponse>
  )
}

function renderStructuredContent(
  content: ThreadMessage["content"],
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

function AssistantMessage(props: {
  isLastAssistant: boolean
  isLoading?: boolean
  message: ThreadMessage
  onApprovalDecision?: (decision: "approve" | "reject" | "edit") => void
  onRetry?: () => Promise<void> | void
  pendingApproval?: HITLRequest | null
  toolResults: Map<string, ToolResultInfo>
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const {
    isLastAssistant,
    isLoading,
    message,
    onApprovalDecision,
    onRetry,
    pendingApproval,
    toolResults
  } = props
  const content = renderStructuredContent(message.content, {
    isStreaming: Boolean(isLoading) && isLastAssistant,
    isUser: false
  })
  const toolCalls = message.tool_calls ?? []
  const pendingId = pendingApproval?.tool_call?.id

  if (!content.attachments && !content.textContent && toolCalls.length === 0) {
    return null
  }

  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent className="w-full gap-3">
        {content.attachments}
        {content.textContent ? <div className="space-y-4">{content.textContent}</div> : null}
        {toolCalls.length > 0 ? (
          <div className="space-y-3">
            {toolCalls.map((toolCall, index) => {
              const result = toolResults.get(toolCall.id)
              const needsApproval = Boolean(pendingId) && pendingId === toolCall.id

              return (
                <ToolCallRenderer
                  key={`${toolCall.id || `tc-${index}`}-${needsApproval ? "pending" : "done"}`}
                  isError={result?.is_error}
                  needsApproval={needsApproval}
                  onApprovalDecision={needsApproval ? onApprovalDecision : undefined}
                  result={result?.content}
                  toolCall={toolCall}
                />
              )
            })}
          </div>
        ) : null}
      </MessageContent>

      <MessageToolbar className="mt-0 justify-end">
        <MessageActions>
          {isLastAssistant && onRetry && !isLoading ? (
            <MessageAction
              label={copy.chat.retryMessage}
              onClick={() => void onRetry()}
              tooltip={copy.chat.retryMessage}
            >
              <RefreshCcwIcon className="size-4" />
            </MessageAction>
          ) : null}
          <MessageAction
            label={copy.chat.copyMessage}
            onClick={() => void navigator.clipboard.writeText(extractMessageText(message.content))}
            tooltip={copy.chat.copyMessage}
          >
            <CopyIcon className="size-4" />
          </MessageAction>
        </MessageActions>
      </MessageToolbar>
    </Message>
  )
}

function UserMessage(props: { message: ThreadMessage }): React.JSX.Element | null {
  const { message } = props
  const content = renderStructuredContent(message.content, { isUser: true })

  if (!content.attachments && !content.textContent) {
    return null
  }

  return (
    <Message from="user">
      {content.attachments}
      {content.textContent ? (
        <MessageContent className="gap-3">{content.textContent}</MessageContent>
      ) : null}
    </Message>
  )
}

export function Messages(props: MessagesProps): React.JSX.Element {
  const { isLoading, messages, onApprovalDecision, onRetry, pendingApproval } = props
  const toolResults = useMemo(() => buildToolResults(messages), [messages])
  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role !== "tool"),
    [messages]
  )
  const lastAssistantId =
    [...visibleMessages].reverse().find((message) => message.role === "assistant")?.id ?? null

  return (
    <>
      {visibleMessages.map((message) => {
        if (message.role === "user") {
          return <UserMessage key={message.id} message={message} />
        }

        return (
          <AssistantMessage
            isLastAssistant={message.id === lastAssistantId}
            isLoading={isLoading}
            key={message.id}
            message={message}
            onApprovalDecision={onApprovalDecision}
            onRetry={onRetry}
            pendingApproval={pendingApproval}
            toolResults={toolResults}
          />
        )
      })}
    </>
  )
}
