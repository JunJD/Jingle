import { CopyIcon, FileText, ListTodo, RefreshCcwIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { resolveImageBlockUrl } from "@shared/message-content"
import type {
  ContentBlock,
  HITLDecision,
  HITLRequest,
  Message as ThreadMessage,
  ToolCall
} from "@/types"
import { ActionMessage, ToolStatusIndicator } from "./ActionMessage"
import { createActionMessageView } from "./action-message-view"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import {
  buildTurnAssistantEntries,
  countToolCalls,
  getTurnCopyText,
  projectMessages,
  shouldDefaultExpandToolEntries,
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
  density?: "default" | "compact"
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
      fallbackIcon: <FileText className="size-[var(--ow-icon-display)] text-muted-foreground" />
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
        "w-fit max-w-full gap-[var(--ow-gap-md)]",
        isUser ? "ml-auto justify-end" : "justify-start"
      )}
    >
      {attachments.map(({ data, fallbackIcon }) => (
        <AttachmentHoverCard key={data.id}>
          <AttachmentHoverCardTrigger asChild>
            <Attachment
              data={data}
              className={cn(
                "size-[var(--ow-chat-attachment-image-size)] overflow-hidden rounded-[var(--ow-chat-attachment-image-radius)] border-0 bg-background-secondary shadow-[0_8px_24px_rgba(0,0,0,0.14)]",
                "sm:size-[var(--ow-chat-attachment-image-size-wide)]"
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
    density?: "default" | "compact"
    isStreaming?: boolean
    isUser: boolean
    key: string
  }
): React.JSX.Element | null {
  const { density = "default", isStreaming, isUser, key } = options

  if (!text.trim()) {
    return null
  }

  if (isUser) {
    return (
      <div
        key={key}
        className={cn(
          "whitespace-pre-wrap [overflow-wrap:anywhere]",
          density === "compact"
            ? "[font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
            : "[font-size:var(--ow-font-display)] leading-[var(--ow-line-reading)]"
        )}
      >
        {text}
      </div>
    )
  }

  return (
    <MessageResponse
      key={key}
      className={cn(
        "min-w-0",
        density === "compact"
          ? "[font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
          : "[font-size:var(--ow-font-display)] leading-[var(--ow-line-reading)]"
      )}
      isAnimating={isStreaming}
    >
      {text}
    </MessageResponse>
  )
}

function renderStructuredContent(
  content: ThreadMessage["content"],
  options: {
    density?: "default" | "compact"
    isStreaming?: boolean
    isUser: boolean
  }
): StructuredMessageContent {
  const { density = "default", isStreaming, isUser } = options

  if (typeof content === "string") {
    return {
      attachments: null,
      textContent: renderTextBlock(content, {
        density,
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
        density,
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
  defaultOpen?: boolean
  density?: "default" | "compact"
  preferLatestToolSummary?: boolean
  onApprovalDecision?: (decision: HITLDecision) => void
  onOpenChange?: (open: boolean) => void
  open?: boolean
  pendingApproval?: HITLRequest | null
  toolCalls: ToolCall[]
  toolResults: Map<string, ToolResultInfo>
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const {
    defaultOpen = false,
    density = "default",
    onApprovalDecision,
    onOpenChange,
    open,
    pendingApproval,
    preferLatestToolSummary,
    toolCalls,
    toolResults
  } = props
  const pendingId = pendingApproval?.tool_call?.id
  const [openOverride, setOpenOverride] = useState<boolean | null>(null)

  if (toolCalls.length === 0) {
    return null
  }

  const actionItems = toolCalls.map((toolCall, index) => {
    const result = toolResults.get(toolCall.id)
    const needsApproval = Boolean(pendingId) && pendingId === toolCall.id

    return {
      key: toolCall.id || `tc-${index}`,
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

  const hasActiveActions = actionItems.some(
    (item) => item.needsApproval || item.result === undefined
  )
  const isOpen = open ?? openOverride ?? defaultOpen
  const latestActiveAction = [...actionViews]
    .reverse()
    .find((item) => item.needsApproval || item.result === undefined)
  const latestToolAction = actionViews[actionViews.length - 1]
  const headerAction = hasActiveActions ? latestActiveAction : latestToolAction
  const headerTitle =
    (preferLatestToolSummary && hasActiveActions
      ? isOpen
        ? copy.chat.agentWorking
        : headerAction?.view.summary
      : null) ??
    headerAction?.view.summary ??
    copy.chat.executedSteps(toolCalls.length)
  const headerStatusMeta =
    !isOpen && hasActiveActions && headerAction ? (
      <ToolStatusIndicator
        runningLabel={copy.common.running}
        status={headerAction.view.status}
        statusLabel={headerAction.view.statusLabel}
      />
    ) : null

  return (
    <ChainOfThought
      active={hasActiveActions}
      onOpenChange={onOpenChange ?? setOpenOverride}
      open={isOpen}
    >
      <ChainOfThoughtHeader
        className={
          density === "compact"
            ? "[font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
            : "[font-size:var(--ow-font-control)] leading-[var(--ow-line-chat)]"
        }
        {...(headerAction ? { "data-tool-call-toggle": headerAction.toolCall.name } : {})}
        icon={ListTodo}
        meta={headerStatusMeta}
      >
        {headerTitle}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent
        className={
          density === "compact" ? "space-y-[var(--ow-space-2)]" : "space-y-[var(--ow-space-2-5)]"
        }
      >
        {actionViews.map((item, index) => (
          <ChainOfThoughtItem
            icon={item.view.icon}
            isLast={index === actionViews.length - 1}
            key={item.key}
          >
            <ActionMessage
              approvalRequest={item.needsApproval ? pendingApproval : null}
              density={density}
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
  defaultExpanded?: boolean
  density?: "default" | "compact"
  preferLatestToolSummary?: boolean
  messages: ThreadMessage[]
  onApprovalDecision?: (decision: HITLDecision) => void
  pendingApproval?: HITLRequest | null
  toolResults: Map<string, ToolResultInfo>
}): React.JSX.Element | null {
  const {
    defaultExpanded = false,
    density = "default",
    messages,
    onApprovalDecision,
    pendingApproval,
    preferLatestToolSummary,
    toolResults
  } = props
  const toolCalls = messages.flatMap((message) => message.tool_calls ?? [])
  const toolCallCount = countToolCalls(messages)
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null)
  const isExpanded = expandedOverride ?? defaultExpanded

  if (toolCalls.length === 0) {
    return null
  }

  if (toolCallCount === 1) {
    const toolCall = toolCalls[0]

    if (!toolCall) {
      return null
    }

    const needsApproval = pendingApproval?.tool_call?.id === toolCall.id

    return (
      <Message className="max-w-full" from="assistant">
        <MessageContent
          className={
            density === "compact"
              ? "w-full gap-[var(--ow-space-2-5)]"
              : "w-full gap-[var(--ow-gap-md)]"
          }
        >
          <ActionMessage
            approvalRequest={needsApproval ? pendingApproval : null}
            density={density}
            expanded={isExpanded}
            onApprovalDecision={needsApproval ? onApprovalDecision : undefined}
            onExpandedChange={setExpandedOverride}
            result={toolResults.get(toolCall.id)?.content}
            toolCall={toolCall}
          />
        </MessageContent>
      </Message>
    )
  }

  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent className="w-full gap-[var(--ow-gap-md)]">
        <ToolActivityGroup
          defaultOpen={defaultExpanded}
          density={density}
          onApprovalDecision={onApprovalDecision}
          onOpenChange={setExpandedOverride}
          open={isExpanded}
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
  density?: "default" | "compact"
  isLastAssistant: boolean
  isLoading?: boolean
  message: ThreadMessage
}): React.JSX.Element | null {
  const { density = "default", isLastAssistant, isLoading, message } = props
  const content = renderStructuredContent(message.content, {
    density,
    isStreaming: Boolean(isLoading) && isLastAssistant,
    isUser: false
  })

  if (!content.attachments && !content.textContent) {
    return null
  }

  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent className="w-full gap-[var(--ow-gap-md)]">
        {content.attachments}
        {content.textContent ? (
          <div
            className={
              density === "compact" ? "space-y-[var(--ow-space-3)]" : "space-y-[var(--ow-space-4)]"
            }
          >
            {content.textContent}
          </div>
        ) : null}
      </MessageContent>
    </Message>
  )
}

function UserMessage(props: {
  density?: "default" | "compact"
  message: ThreadMessage
}): React.JSX.Element | null {
  const { density = "default", message } = props
  const content = renderStructuredContent(message.content, { density, isUser: true })

  if (!content.attachments && !content.textContent) {
    return null
  }

  return (
    <Message from="user">
      {content.attachments}
      {content.textContent ? (
        <MessageContent
          className={density === "compact" ? "gap-[var(--ow-space-2-5)]" : "gap-[var(--ow-gap-md)]"}
        >
          {content.textContent}
        </MessageContent>
      ) : null}
    </Message>
  )
}

function MessageTurnView(props: {
  density?: "default" | "compact"
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
    density = "default",
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
  const shouldHideToolbar = Boolean(isLoading) && isActiveTurn
  const assistantEntries = useMemo(() => buildTurnAssistantEntries(turn), [turn])
  const isStreamingTurn = Boolean(isLoading) && isActiveTurn
  const defaultExpandToolEntries = useMemo(
    () => shouldDefaultExpandToolEntries(turn, { isStreaming: isStreamingTurn }),
    [isStreamingTurn, turn]
  )

  return (
    <div
      className={
        density === "compact" ? "space-y-[var(--ow-space-2-5)]" : "space-y-[var(--ow-space-3)]"
      }
    >
      {turn.user ? <UserMessage density={density} message={turn.user} /> : null}
      {assistantEntries.map((entry) => {
        if (entry.kind === "assistant-content") {
          return (
            <AssistantBlock
              density={density}
              isLastAssistant={entry.message.id === lastAssistantId}
              isLoading={isLoading}
              key={entry.key}
              message={entry.message}
            />
          )
        }

        return (
          <AssistantToolCluster
            defaultExpanded={defaultExpandToolEntries}
            density={density}
            key={entry.key}
            messages={entry.messages}
            onApprovalDecision={onApprovalDecision}
            pendingApproval={pendingApproval}
            preferLatestToolSummary={isActiveTurn && Boolean(isLoading)}
            toolResults={toolResults}
          />
        )
      })}

      {hasAssistantMessages && !shouldHideToolbar ? (
        <MessageToolbar className="mt-0 justify-end">
          <MessageActions>
            {isActiveTurn && onRetry && !isLoading ? (
              <MessageAction
                label={copy.chat.retryMessage}
                onClick={() => void onRetry()}
                tooltip={copy.chat.retryMessage}
              >
                <RefreshCcwIcon className="size-[var(--ow-icon-action)]" />
              </MessageAction>
            ) : null}
            {copyText ? (
              <MessageAction
                label={copy.chat.copyMessage}
                onClick={() => void navigator.clipboard.writeText(copyText)}
                tooltip={copy.chat.copyMessage}
              >
                <CopyIcon className="size-[var(--ow-icon-action)]" />
              </MessageAction>
            ) : null}
          </MessageActions>
        </MessageToolbar>
      ) : null}
    </div>
  )
}

export function Messages(props: MessagesProps): React.JSX.Element {
  const {
    density = "default",
    isLoading,
    messages,
    onApprovalDecision,
    onRetry,
    pendingApproval
  } = props
  const { activeTurnKey, lastAssistantId, toolResults, turns } = useMemo(
    () => projectMessages(messages),
    [messages]
  )

  return (
    <>
      {turns.map((turn) => (
        <MessageTurnView
          density={density}
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
