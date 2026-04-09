import { CopyIcon, FileText, ListTodo, RefreshCcwIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { resolveImageBlockUrl } from "../../../../shared/message-content"
import type {
  ContentBlock,
  HITLDecision,
  HITLRequest,
  Message as ThreadMessage,
  ToolCall
} from "@/types"
import { ActionMessage } from "./ActionMessage"
import { createActionMessageView } from "./action-message-view"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import {
  buildTurnAssistantEntries,
  getTurnCopyText,
  projectMessages,
  type MessageTurn,
  type ToolResultInfo
} from "./message-projection"
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
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtItem
} from "./ChainOfThought"
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
  MessageToolbar
} from "./message"

interface MessagesProps {
  messages: ThreadMessage[]
  isLoading?: boolean
  pendingApproval?: HITLRequest | null
  onApprovalDecision?: (decision: HITLDecision) => void
  onRetry?: () => Promise<void> | void
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

function ToolActivityGroup(props: {
  preferLatestToolSummary?: boolean
  onApprovalDecision?: (decision: HITLDecision) => void
  pendingApproval?: HITLRequest | null
  toolCalls: ToolCall[]
  toolResults: Map<string, ToolResultInfo>
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { onApprovalDecision, pendingApproval, preferLatestToolSummary, toolCalls, toolResults } =
    props
  const pendingId = pendingApproval?.tool_call?.id
  const [openOverride, setOpenOverride] = useState<boolean | null>(null)

  if (toolCalls.length === 0) {
    return null
  }

  const actionItems = toolCalls.map((toolCall, index) => {
    const result = toolResults.get(toolCall.id)
    const needsApproval = Boolean(pendingId) && pendingId === toolCall.id

    return {
      key: `${toolCall.id || `tc-${index}`}-${needsApproval ? "pending" : "done"}`,
      needsApproval,
      result,
      toolCall
    }
  })
  const actionViews = actionItems.map((item) => {
    const view = createActionMessageView({
      approvalRequest: item.needsApproval ? pendingApproval : null,
      copy,
      presentation: "grouped",
      result: item.result?.content,
      toolCall: item.toolCall
    })

    return {
      ...item,
      view
    }
  })

  const shouldGroup = toolCalls.length >= 2
  const hasActiveActions = actionItems.some(
    (item) => item.needsApproval || item.result === undefined
  )
  const isOpen = openOverride ?? hasActiveActions
  const latestActiveAction = [...actionViews]
    .reverse()
    .find((item) => item.needsApproval || item.result === undefined)
  const latestToolAction = actionViews[actionViews.length - 1]
  const headerTitle =
    (preferLatestToolSummary
      ? isOpen
        ? copy.chat.agentWorking
        : latestToolAction?.view.summary
      : null) ??
    latestActiveAction?.view.summary ??
    copy.chat.executedSteps(toolCalls.length)

  if (!shouldGroup) {
    const item = actionItems[0]

    return item ? (
      <ActionMessage
        approvalRequest={item.needsApproval ? pendingApproval : null}
        onApprovalDecision={item.needsApproval ? onApprovalDecision : undefined}
        result={item.result?.content}
        toolCall={item.toolCall}
      />
    ) : null
  }

  return (
    <ChainOfThought
      active={hasActiveActions}
      collapseWhenInactive
      onOpenChange={setOpenOverride}
      open={isOpen}
    >
      <ChainOfThoughtHeader className="text-[13px] leading-5" icon={ListTodo}>
        {headerTitle}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent className="space-y-2.5">
        {actionViews.map((item, index) => (
          <ChainOfThoughtItem
            icon={item.view.icon}
            isLast={index === actionViews.length - 1}
            key={item.key}
          >
            <ActionMessage
              approvalRequest={item.needsApproval ? pendingApproval : null}
              onApprovalDecision={item.needsApproval ? onApprovalDecision : undefined}
              presentation="grouped"
              result={item.result?.content}
              toolCall={item.toolCall}
            />
          </ChainOfThoughtItem>
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}

function AssistantToolCluster(props: {
  preferLatestToolSummary?: boolean
  messages: ThreadMessage[]
  onApprovalDecision?: (decision: HITLDecision) => void
  pendingApproval?: HITLRequest | null
  toolResults: Map<string, ToolResultInfo>
}): React.JSX.Element | null {
  const { messages, onApprovalDecision, pendingApproval, preferLatestToolSummary, toolResults } =
    props
  const toolCalls = messages.flatMap((message) => message.tool_calls ?? [])

  if (toolCalls.length === 0) {
    return null
  }

  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent className="w-full gap-3">
        <ToolActivityGroup
          onApprovalDecision={onApprovalDecision}
          pendingApproval={pendingApproval}
          preferLatestToolSummary={preferLatestToolSummary}
          toolCalls={toolCalls}
          toolResults={toolResults}
        />
      </MessageContent>
    </Message>
  )
}

function AssistantBlock(props: {
  isLastAssistant: boolean
  isLoading?: boolean
  message: ThreadMessage
}): React.JSX.Element | null {
  const { isLastAssistant, isLoading, message } = props
  const content = renderStructuredContent(message.content, {
    isStreaming: Boolean(isLoading) && isLastAssistant,
    isUser: false
  })

  if (!content.attachments && !content.textContent) {
    return null
  }

  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent className="w-full gap-3">
        {content.attachments}
        {content.textContent ? <div className="space-y-4">{content.textContent}</div> : null}
      </MessageContent>
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

function MessageTurnView(props: {
  isActiveTurn: boolean
  isLoading?: boolean
  lastAssistantId: string | null
  onApprovalDecision?: (decision: HITLDecision) => void
  onRetry?: () => Promise<void> | void
  pendingApproval?: HITLRequest | null
  toolResults: Map<string, ToolResultInfo>
  turn: MessageTurn
}): React.JSX.Element {
  const { copy } = useI18n()
  const {
    isActiveTurn,
    isLoading,
    lastAssistantId,
    onApprovalDecision,
    onRetry,
    pendingApproval,
    toolResults,
    turn
  } = props
  const copyText = getTurnCopyText(turn)
  const hasAssistantMessages = turn.assistants.length > 0
  const assistantEntries = useMemo(() => buildTurnAssistantEntries(turn), [turn])

  return (
    <div className="space-y-3">
      {turn.user ? <UserMessage message={turn.user} /> : null}
      {assistantEntries.map((entry) => {
        if (entry.kind === "assistant-content") {
          return (
            <AssistantBlock
              isLastAssistant={entry.message.id === lastAssistantId}
              isLoading={isLoading}
              key={entry.key}
              message={entry.message}
            />
          )
        }

        return (
          <AssistantToolCluster
            key={entry.key}
            messages={entry.messages}
            onApprovalDecision={onApprovalDecision}
            pendingApproval={pendingApproval}
            preferLatestToolSummary={isActiveTurn && Boolean(isLoading)}
            toolResults={toolResults}
          />
        )
      })}

      {hasAssistantMessages ? (
        <MessageToolbar className="mt-0 justify-end">
          <MessageActions>
            {isActiveTurn && onRetry && !isLoading ? (
              <MessageAction
                label={copy.chat.retryMessage}
                onClick={() => void onRetry()}
                tooltip={copy.chat.retryMessage}
              >
                <RefreshCcwIcon className="size-4" />
              </MessageAction>
            ) : null}
            {copyText ? (
              <MessageAction
                label={copy.chat.copyMessage}
                onClick={() => void navigator.clipboard.writeText(copyText)}
                tooltip={copy.chat.copyMessage}
              >
                <CopyIcon className="size-4" />
              </MessageAction>
            ) : null}
          </MessageActions>
        </MessageToolbar>
      ) : null}
    </div>
  )
}

export function Messages(props: MessagesProps): React.JSX.Element {
  const { isLoading, messages, onApprovalDecision, onRetry, pendingApproval } = props
  const { activeTurnKey, lastAssistantId, toolResults, turns } = useMemo(
    () => projectMessages(messages),
    [messages]
  )

  return (
    <>
      {turns.map((turn) => (
        <MessageTurnView
          isActiveTurn={turn.key === activeTurnKey}
          isLoading={isLoading}
          key={turn.key}
          lastAssistantId={lastAssistantId}
          onApprovalDecision={onApprovalDecision}
          onRetry={onRetry}
          pendingApproval={pendingApproval}
          toolResults={toolResults}
          turn={turn}
        />
      ))}
    </>
  )
}
