import { FileText, GitForkIcon, RefreshCcwIcon } from "lucide-react"
import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject
} from "react"
import { VList, type VListHandle } from "virtua"
import { resolveImageBlockUrl } from "@shared/message-content"
import type { ContentBlock, HITLRequest, Message as ThreadMessage, ToolCall } from "@/types"
import { ActionMessage, ToolStatusIndicator } from "./ActionMessage"
import {
  AgentSteps,
  AgentStepsContent,
  AgentStepsTrigger,
  AgentToolGroup,
  AgentToolGroupContent,
  AgentToolGroupItem,
  AgentToolGroupTrigger
} from "@/components/agent-ui"
import { createActionMessageView } from "./action-message-view"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import {
  buildTurnAssistantEntries,
  countToolCalls,
  getTurnToolDisplayPolicy,
  getTurnPendingApproval,
  getTurnCopyText,
  type MessagesProjection,
  type MessageTurn,
  type ToolResultInfo
} from "@/lib/message-projection"
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
import { ExtensionSourceTextViewer } from "./ExtensionSourceTextViewer"
import { LoaderOne } from "../ui/loader"
import { CopyButton } from "../ui/button"

function ThinkingIcon(props: React.SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M3.5 19A1.5 1.5 0 0 1 5 20.5A1.5 1.5 0 0 1 3.5 22A1.5 1.5 0 0 1 2 20.5A1.5 1.5 0 0 1 3.5 19m5-3a2.5 2.5 0 0 1 2.5 2.5A2.5 2.5 0 0 1 8.5 21A2.5 2.5 0 0 1 6 18.5A2.5 2.5 0 0 1 8.5 16m6-1c-1.19 0-2.27-.5-3-1.35c-.73.85-1.81 1.35-3 1.35c-1.96 0-3.59-1.41-3.93-3.26A4.02 4.02 0 0 1 2 8a4 4 0 0 1 4-4c.26 0 .5.03.77.07C7.5 3.41 8.45 3 9.5 3c1.19 0 2.27.5 3 1.35c.73-.85 1.81-1.35 3-1.35c1.96 0 3.59 1.41 3.93 3.26A4.02 4.02 0 0 1 22 10a4 4 0 0 1-4 4l-.77-.07c-.73.66-1.68 1.07-2.73 1.07" />
    </svg>
  )
}

interface MessagesProps {
  bottomInset?: number
  contentClassName?: string
  contentInsetY?: string
  density?: "default" | "compact"
  footerSlot?: ReactNode
  projection: MessagesProjection
  virtualizerRef?: RefObject<VListHandle | null>
  isAtBottom?: boolean
  isLoading?: boolean
  isScrolling?: boolean
  onUserScrollIntent?: () => void
  onScroll?: () => void
  onScrollEnd?: () => void
  onScrollToLatest?: () => void
  pendingApproval?: HITLRequest | null
  onBranch?: (messageId: string) => Promise<void> | void
  onRetry?: () => Promise<void> | void
}

interface StructuredMessageContent {
  attachments: React.ReactNode
  reasoningContent: React.ReactNode
  textContent: React.ReactNode
}

const EMPTY_TOOL_EXPANSION_OVERRIDES = new Map<string, boolean>()
const SCROLL_INTENT_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " "
])

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
        <ExtensionSourceTextViewer text={text} />
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

function getReasoningBlockText(block: ContentBlock): string {
  return block.reasoning ?? block.text ?? block.content ?? ""
}

function getStreamingContentSignature(content: ThreadMessage["content"]): string {
  if (typeof content === "string") {
    return `${content.length}:0:0`
  }

  let textLength = 0
  let reasoningLength = 0
  for (const block of content) {
    if (block.type === "reasoning") {
      reasoningLength += getReasoningBlockText(block).length
      continue
    }

    textLength += (block.text ?? block.content ?? "").length
  }

  return `${textLength}:${reasoningLength}:${content.length}`
}

function getToolResultsSignature(toolResults: Map<string, ToolResultInfo>): string {
  if (toolResults.size === 0) {
    return "0"
  }

  return Array.from(toolResults, ([toolCallId, result]) => {
    return `${toolCallId}:${getStreamingContentSignature(result.content)}`
  }).join("|")
}

function getStreamingTurnSignature(
  turn: MessageTurn | null | undefined,
  message: ThreadMessage | null | undefined
): string | null {
  if (!turn || !message) {
    return null
  }

  const toolCallCount = message.tool_calls?.length ?? 0
  return [
    message.id,
    getStreamingContentSignature(message.content),
    toolCallCount,
    getToolResultsSignature(turn.toolResults)
  ].join(":")
}

function ReasoningBlock(props: {
  density?: "default" | "compact"
  isStreaming?: boolean
  text: string
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { density = "default", isStreaming, text } = props

  if (!text.trim()) {
    return null
  }

  return (
    <AgentSteps active={isStreaming} className="ow-reasoning-message" defaultOpen={isStreaming}>
      <AgentStepsTrigger
        className={cn(
          "ow-reasoning-trigger",
          !isStreaming && "opacity-55",
          density === "compact"
            ? "[font-size:var(--ow-font-meta)] leading-[var(--ow-line-chat)]"
            : "[font-size:var(--ow-font-control)] leading-[var(--ow-line-chat)]"
        )}
        icon={
          isStreaming ? (
            <LoaderOne className="size-[var(--ow-icon-action)] justify-center text-muted-foreground/90 transition-opacity group-hover:opacity-100" />
          ) : (
            <ThinkingIcon className="size-[var(--ow-icon-action)] opacity-90 transition-opacity group-hover:opacity-100" />
          )
        }
      >
        {isStreaming ? copy.chat.agentThinking : copy.chat.agentThought}
      </AgentStepsTrigger>
      <AgentStepsContent
        bar={false}
        className={cn(
          "ow-reasoning-content",
          density === "compact"
            ? "space-y-[var(--ow-space-2)]"
            : "space-y-[var(--ow-reasoning-content-gap)]"
        )}
      >
        <div className="pl-[calc(var(--ow-icon-action)+var(--ow-gap-sm))] whitespace-pre-wrap [overflow-wrap:anywhere] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-muted-foreground/72">
          {text}
        </div>
      </AgentStepsContent>
    </AgentSteps>
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
      reasoningContent: null,
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
  const reasoningText = isUser
    ? ""
    : content
        .filter((block) => block.type === "reasoning")
        .map(getReasoningBlockText)
        .join("")

  const lastTextBlockIndex = [...content]
    .reverse()
    .findIndex(
      (block) =>
        block.type !== "reasoning" &&
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

      if (block.type === "reasoning") {
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
    reasoningContent: reasoningText.trim() ? (
      <ReasoningBlock density={density} isStreaming={isStreaming} text={reasoningText} />
    ) : null,
    textContent: textBlocks.length > 0 ? textBlocks : null
  }
}

function ToolActivityGroup(props: {
  defaultOpen?: boolean
  density?: "default" | "compact"
  preferLatestToolSummary?: boolean
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
    <AgentToolGroup
      active={hasActiveActions}
      onOpenChange={onOpenChange ?? setOpenOverride}
      open={isOpen}
    >
      <AgentToolGroupTrigger
        className={
          density === "compact"
            ? "[font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
            : "[font-size:var(--ow-font-control)] leading-[var(--ow-line-chat)]"
        }
        {...(headerAction ? { "data-tool-call-toggle": headerAction.toolCall.name } : {})}
        meta={headerStatusMeta}
      >
        {headerTitle}
      </AgentToolGroupTrigger>
      <AgentToolGroupContent
        className={
          density === "compact" ? "space-y-[var(--ow-space-2)]" : "space-y-[var(--ow-space-2-5)]"
        }
      >
        {actionViews.map((item) => {
          const Icon = item.view.icon

          return (
            <AgentToolGroupItem icon={<Icon className="size-[var(--ow-icon-sm)]" />} key={item.key}>
              <ActionMessage
                approvalRequest={item.needsApproval ? pendingApproval : null}
                presentation="grouped"
                result={item.result?.content}
                toolCall={item.toolCall}
              />
            </AgentToolGroupItem>
          )
        })}
      </AgentToolGroupContent>
    </AgentToolGroup>
  )
}

function AssistantToolCluster(props: {
  defaultExpanded?: boolean
  density?: "default" | "compact"
  expanded?: boolean
  preferLatestToolSummary?: boolean
  messages: ThreadMessage[]
  onExpandedChange?: (expanded: boolean) => void
  pendingApproval?: HITLRequest | null
  toolResults: Map<string, ToolResultInfo>
}): React.JSX.Element | null {
  const {
    defaultExpanded = false,
    density = "default",
    expanded,
    messages,
    onExpandedChange,
    pendingApproval,
    preferLatestToolSummary,
    toolResults
  } = props
  const toolCalls = messages.flatMap((message) => message.tool_calls ?? [])
  const toolCallCount = countToolCalls(messages)
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null)
  const handleExpandedChange = onExpandedChange ?? setExpandedOverride
  const isExpanded = expanded ?? expandedOverride ?? defaultExpanded

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
            expanded={isExpanded}
            onExpandedChange={handleExpandedChange}
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
          onOpenChange={handleExpandedChange}
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

  if (!content.attachments && !content.reasoningContent && !content.textContent) {
    return null
  }

  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent className="w-full gap-[var(--ow-gap-md)]">
        {content.attachments}
        {content.reasoningContent}
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

const MessageTurnView = memo(function MessageTurnView(props: {
  density?: "default" | "compact"
  isActiveTurn: boolean
  onBranch?: (messageId: string) => Promise<void> | void
  onRetry?: () => Promise<void> | void
  pendingApproval?: HITLRequest | null
  isStreaming: boolean
  streamingAssistantId: string | null
  toolExpansionOverrides: ReadonlyMap<string, boolean>
  toolResults: Map<string, ToolResultInfo>
  turn: MessageTurn
  onToolExpansionChange: (turnKey: string, key: string, expanded: boolean) => void
}): React.JSX.Element {
  const { copy } = useI18n()
  const {
    density = "default",
    isActiveTurn,
    isStreaming,
    onBranch,
    onRetry,
    pendingApproval,
    streamingAssistantId,
    toolExpansionOverrides,
    toolResults,
    turn,
    onToolExpansionChange
  } = props
  const copyText = getTurnCopyText(turn)
  const hasAssistantMessages = turn.assistants.length > 0
  const shouldHideToolbar = isStreaming
  const assistantEntries = useMemo(() => buildTurnAssistantEntries(turn), [turn])
  const toolDisplayPolicy = useMemo(
    () => getTurnToolDisplayPolicy(turn, { isStreaming }),
    [isStreaming, turn]
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
              isLastAssistant={entry.message.id === streamingAssistantId}
              isLoading={isStreaming}
              key={entry.key}
              message={entry.message}
            />
          )
        }

        return (
          <AssistantToolCluster
            defaultExpanded={toolDisplayPolicy.defaultExpanded}
            density={density}
            expanded={toolExpansionOverrides.get(entry.key)}
            key={entry.key}
            messages={entry.messages}
            onExpandedChange={(expanded) => onToolExpansionChange(turn.key, entry.key, expanded)}
            pendingApproval={pendingApproval}
            preferLatestToolSummary={toolDisplayPolicy.preferLatestSummary}
            toolResults={toolResults}
          />
        )
      })}

      {hasAssistantMessages && !shouldHideToolbar ? (
        <MessageToolbar className="mt-0 justify-start">
          <MessageActions>
            {isActiveTurn && onRetry && !isStreaming ? (
              <MessageAction
                label={copy.chat.retryMessage}
                onClick={() => void onRetry()}
                tooltip={copy.chat.retryMessage}
              >
                <RefreshCcwIcon className="size-[var(--ow-icon-action)]" />
              </MessageAction>
            ) : null}
            {turn.branchMessageId && onBranch && !isStreaming ? (
              <MessageAction
                label={copy.launcher.branchChat}
                onClick={() => {
                  if (turn.branchMessageId) {
                    void onBranch(turn.branchMessageId)
                  }
                }}
                tooltip={copy.launcher.branchChat}
              >
                <GitForkIcon className="size-[var(--ow-icon-sm)]" />
              </MessageAction>
            ) : null}
            {copyText ? (
              <MessageAction asChild label={copy.chat.copyMessage} tooltip={copy.chat.copyMessage}>
                <CopyButton
                  className="size-[22px] rounded-[var(--ow-radius-sm)] text-muted-foreground hover:text-foreground [&_svg]:size-[var(--ow-icon-sm)]"
                  copiedLabel={copy.common.copied}
                  copyLabel={copy.chat.copyMessage}
                  iconClassName="size-[var(--ow-icon-action)]"
                  text={copyText}
                />
              </MessageAction>
            ) : null}
          </MessageActions>
        </MessageToolbar>
      ) : null}
    </div>
  )
})

const MessageAutoScroll = memo(function MessageAutoScroll(props: {
  activeContentSignature: string | number | null
  hasFollowTarget: boolean
  isAtBottom: boolean
  isScrolling: boolean
  observeKey: string
  onScrollToLatest: () => void
  rowRef: RefObject<HTMLDivElement | null>
  signatureRef: RefObject<HTMLDivElement | null>
}): null {
  const {
    activeContentSignature,
    hasFollowTarget,
    isAtBottom,
    isScrolling,
    observeKey,
    onScrollToLatest,
    rowRef,
    signatureRef
  } = props
  const frameRef = useRef<number | null>(null)

  const scheduleScrollToLatest = useEffectEvent(() => {
    const shouldAutoScroll = hasFollowTarget && isAtBottom && !isScrolling
    if (!shouldAutoScroll || frameRef.current !== null) {
      return
    }

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      onScrollToLatest()
    })
  })

  useEffect(() => {
    scheduleScrollToLatest()
  }, [activeContentSignature, hasFollowTarget, observeKey])

  useEffect(() => {
    const nodes = [rowRef.current, signatureRef.current].filter(
      (node): node is HTMLDivElement => node !== null
    )
    if (nodes.length === 0 || typeof ResizeObserver === "undefined") {
      return undefined
    }

    let frameId: number | null = null
    const observer = new ResizeObserver(() => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }

      frameId = requestAnimationFrame(() => {
        frameId = null
        scheduleScrollToLatest()
      })
    })

    for (const node of nodes) {
      observer.observe(node)
    }

    return () => {
      observer.disconnect()
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [observeKey, rowRef, signatureRef])

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
      }
    }
  }, [])

  return null
})

export function Messages(props: MessagesProps): React.JSX.Element {
  const {
    bottomInset = 0,
    contentClassName,
    contentInsetY = "var(--ow-chat-thread-y)",
    density = "default",
    footerSlot,
    isAtBottom = true,
    isLoading,
    isScrolling = false,
    onBranch,
    onRetry,
    onScroll,
    onScrollEnd,
    onScrollToLatest,
    onUserScrollIntent,
    pendingApproval,
    projection,
    virtualizerRef
  } = props
  const { activeTurnKey, displayRows, lastAssistantId, turns } = projection
  const activeTurnIndex = turns.findIndex((turn) => turn.key === activeTurnKey)
  const keepMounted = useMemo(
    () => (isLoading && activeTurnIndex >= 0 ? [activeTurnIndex] : []),
    [activeTurnIndex, isLoading]
  )
  const latestVirtualRowRef = useRef<HTMLDivElement | null>(null)
  const lastTurnRowRef = useRef<HTMLDivElement | null>(null)
  const virtualRowPadding =
    density === "compact" ? "pb-[var(--launcher-ai-turn-gap)]" : "pb-[var(--ow-chat-thread-gap)]"
  const activeTurn = activeTurnKey ? turns.find((turn) => turn.key === activeTurnKey) : null
  const activeAssistant = activeTurn?.assistants.find((message) => message.id === lastAssistantId)
  const activeContentSignature = getStreamingTurnSignature(activeTurn, activeAssistant)
  const lastTurnKey = turns[turns.length - 1]?.key ?? "__empty__"
  const bottomSpacerHeight = `calc(${bottomInset}px + ${contentInsetY})`
  const [toolExpansionOverridesByTurn, setToolExpansionOverridesByTurn] = useState<
    Map<string, ReadonlyMap<string, boolean>>
  >(() => new Map())
  const handleToolExpansionChange = useCallback(
    (turnKey: string, key: string, expanded: boolean) => {
      setToolExpansionOverridesByTurn((current) => {
        const currentTurnOverrides = current.get(turnKey) ?? EMPTY_TOOL_EXPANSION_OVERRIDES
        if (currentTurnOverrides.get(key) === expanded) {
          return current
        }

        const nextTurnOverrides = new Map(currentTurnOverrides)
        nextTurnOverrides.set(key, expanded)
        const next = new Map(current)
        next.set(turnKey, nextTurnOverrides)
        return next
      })
    },
    []
  )
  const getTurnToolExpansionOverrides = useCallback(
    (turn: MessageTurn): ReadonlyMap<string, boolean> =>
      toolExpansionOverridesByTurn.get(turn.key) ?? EMPTY_TOOL_EXPANSION_OVERRIDES,
    [toolExpansionOverridesByTurn]
  )
  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.buttons > 0) {
        onUserScrollIntent?.()
      }
    },
    [onUserScrollIntent]
  )
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (SCROLL_INTENT_KEYS.has(event.key)) {
        onUserScrollIntent?.()
      }
    },
    [onUserScrollIntent]
  )

  const renderTurn = (turn: MessageTurn): ReactElement => {
    const isActiveTurn = turn.key === activeTurnKey
    const isStreaming = isActiveTurn && Boolean(isLoading)
    const turnPendingApproval = getTurnPendingApproval(turn, pendingApproval)
    const streamingAssistantId = isStreaming ? lastAssistantId : null

    return (
      <MessageTurnView
        density={density}
        isActiveTurn={isActiveTurn}
        isStreaming={isStreaming}
        key={turn.key}
        onBranch={isLoading ? undefined : onBranch}
        onRetry={isActiveTurn && !isLoading ? onRetry : undefined}
        pendingApproval={turnPendingApproval}
        streamingAssistantId={streamingAssistantId}
        toolExpansionOverrides={getTurnToolExpansionOverrides(turn)}
        toolResults={turn.toolResults}
        turn={turn}
        onToolExpansionChange={handleToolExpansionChange}
      />
    )
  }

  return (
    <div
      className="h-full min-h-0"
      onKeyDownCapture={handleKeyDown}
      onPointerDownCapture={onUserScrollIntent}
      onPointerMoveCapture={handlePointerMove}
      onTouchMoveCapture={onUserScrollIntent}
      onWheelCapture={onUserScrollIntent}
    >
      <VList
        data={displayRows}
        keepMounted={keepMounted}
        ref={virtualizerRef}
        className="h-full overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-hide"
        style={{
          overflowAnchor: "none",
          paddingTop: contentInsetY
        }}
        onScroll={onScroll}
        onScrollEnd={onScrollEnd}
        bufferSize={typeof window === "undefined" ? 400 : window.innerHeight}
      >
        {(row, index): ReactElement => {
          const isTurnRow = row.kind === "turn"
          const isLastTurnRow = isTurnRow && index === turns.length - 1
          const isLatestVirtualRow = row.kind === "footer"

          return (
            <div
              key={row.key}
              ref={(node) => {
                if (isLastTurnRow) {
                  lastTurnRowRef.current = node
                }

                if (isLatestVirtualRow) {
                  latestVirtualRowRef.current = node
                }
              }}
              className={cn(contentClassName, index < turns.length - 1 && virtualRowPadding)}
            >
              {row.kind === "turn" ? (
                renderTurn(row.turn)
              ) : (
                <>
                  {footerSlot}
                  <div aria-hidden="true" style={{ height: bottomSpacerHeight }} />
                </>
              )}
              {isLatestVirtualRow && onScrollToLatest ? (
                <MessageAutoScroll
                  activeContentSignature={activeContentSignature}
                  hasFollowTarget={turns.length > 0}
                  isAtBottom={isAtBottom}
                  isScrolling={isScrolling}
                  observeKey={`${row.key}:${lastTurnKey}`}
                  onScrollToLatest={onScrollToLatest}
                  rowRef={latestVirtualRowRef}
                  signatureRef={lastTurnRowRef}
                />
              ) : null}
            </div>
          )
        }}
      </VList>
    </div>
  )
}
