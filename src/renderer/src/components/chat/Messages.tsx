import { ChevronRight, FileText, GitForkIcon, RefreshCcwIcon } from "lucide-react"
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
import type { ContentBlock, HITLRequest, Message as ThreadMessage } from "@/types"
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { createActionMessageView } from "./action-message-view"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import {
  buildTurnAssistantEntries,
  getTurnToolDisplayPolicy,
  getTurnPendingApproval,
  getTurnCopyText,
  type AgentActivityItem,
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

const EMPTY_ACTIVITY_EXPANSION_OVERRIDES = new Map<string, boolean>()
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
      <div
        key={key}
        className="whitespace-pre-wrap [overflow-wrap:anywhere] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
      >
        <ExtensionSourceTextViewer text={text} />
      </div>
    )
  }

  return (
    <MessageResponse
      key={key}
      className="min-w-0 [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
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

function ReasoningBlock(props: { isStreaming?: boolean; text: string }): React.JSX.Element | null {
  const { copy } = useI18n()
  const { isStreaming, text } = props

  if (!text.trim()) {
    return null
  }

  return (
    <AgentSteps active={isStreaming} className="ow-reasoning-message" defaultOpen={false}>
      <AgentStepsTrigger
        className="ow-reasoning-trigger [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
        icon={
          isStreaming ? (
            <LoaderOne className="size-[var(--ow-icon-action)] justify-center text-[var(--ow-agent-timeline-muted)] transition-opacity group-hover:opacity-100" />
          ) : (
            <ThinkingIcon className="size-[var(--ow-icon-action)] transition-opacity group-hover:opacity-100" />
          )
        }
      >
        {copy.chat.agentThought}
      </AgentStepsTrigger>
      <AgentStepsContent bar={false} className="ow-reasoning-content space-y-[var(--ow-space-2)]">
        <div className="pl-[calc(var(--ow-icon-action)+var(--ow-gap-sm))] whitespace-pre-wrap [overflow-wrap:anywhere] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]">
          {text}
        </div>
      </AgentStepsContent>
    </AgentSteps>
  )
}

function renderStructuredContent(
  content: ThreadMessage["content"],
  options: {
    includeReasoning?: boolean
    isStreaming?: boolean
    isUser: boolean
  }
): StructuredMessageContent {
  const { includeReasoning = true, isStreaming, isUser } = options

  if (typeof content === "string") {
    return {
      attachments: null,
      reasoningContent: null,
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
  const reasoningText =
    isUser || !includeReasoning
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
        isStreaming: isStreaming && index === resolvedLastTextBlockIndex,
        isUser,
        key: `${block.type}-${index}`
      })
    })
    .filter(Boolean)

  return {
    attachments: <MessageAttachments blocks={attachmentBlocks} isUser={isUser} />,
    reasoningContent: reasoningText.trim() ? (
      <ReasoningBlock isStreaming={isStreaming} text={reasoningText} />
    ) : null,
    textContent: textBlocks.length > 0 ? textBlocks : null
  }
}

function isThinkingItemStreaming(
  item: AgentActivityItem,
  options: { isStreaming: boolean; streamingAssistantId: string | null }
): boolean {
  return (
    item.kind === "thinking" &&
    options.isStreaming &&
    item.messageId === options.streamingAssistantId
  )
}

function ThinkingActivityContent(props: {
  item: Extract<AgentActivityItem, { kind: "thinking" }>
  streaming: boolean
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { item, streaming } = props

  if (!item.text.trim()) {
    return null
  }

  return (
    <Collapsible
      className="ow-agent-activity-thinking"
      data-active={streaming ? "true" : "false"}
      defaultOpen={false}
    >
      <CollapsibleTrigger className="group flex w-full min-w-0 cursor-pointer items-center gap-[var(--ow-gap-sm)] text-left text-[var(--ow-agent-timeline-muted)] transition-colors [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="ow-agent-activity-thinking-title min-w-0 flex-1 [overflow-wrap:anywhere]">
          {copy.chat.agentThought}
        </span>
        <ChevronRight className="ow-agent-tool-chevron size-[var(--ow-icon-sm)] shrink-0 text-[var(--ow-agent-timeline-muted)] group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="ow-reasoning-content ow-agent-tool-content overflow-hidden">
        <div className="mt-[var(--ow-space-1)] whitespace-pre-wrap [overflow-wrap:anywhere] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-[var(--ow-reasoning-content-fg)]">
          {item.text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

type ThinkingActivityView = {
  item: Extract<AgentActivityItem, { kind: "thinking" }>
  key: string
  kind: "thinking"
  streaming: boolean
}

type ToolActivityView = {
  item: Extract<AgentActivityItem, { kind: "tool" }>
  key: string
  kind: "tool"
  needsApproval: boolean
  result: ToolResultInfo | undefined
  view: ReturnType<typeof createActionMessageView>
}

type ActivityView = ThinkingActivityView | ToolActivityView

function isActivityViewPending(action: ActivityView): boolean {
  return action.kind === "thinking"
    ? action.streaming
    : action.needsApproval || action.result === undefined
}

function isActivityViewLoading(action: ActivityView): boolean {
  return action.kind === "thinking"
    ? action.streaming
    : !action.needsApproval && action.result === undefined
}

function AgentActivityGroup(props: {
  defaultOpen?: boolean
  isStreaming: boolean
  items: AgentActivityItem[]
  preferLatestToolSummary?: boolean
  onOpenChange?: (open: boolean) => void
  open?: boolean
  pendingApproval?: HITLRequest | null
  streamingAssistantId: string | null
  toolResults: Map<string, ToolResultInfo>
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const {
    defaultOpen = false,
    isStreaming,
    items,
    onOpenChange,
    open,
    pendingApproval,
    preferLatestToolSummary,
    streamingAssistantId,
    toolResults
  } = props
  const pendingId = pendingApproval?.tool_call?.id
  const [openOverride, setOpenOverride] = useState<boolean | null>(null)

  if (items.length === 0) {
    return null
  }

  const actionViews: ActivityView[] = items.map((item): ActivityView => {
    if (item.kind === "thinking") {
      return {
        item,
        key: item.key,
        kind: "thinking",
        streaming: isThinkingItemStreaming(item, { isStreaming, streamingAssistantId })
      }
    }

    const result = toolResults.get(item.toolCall.id)
    const needsApproval = Boolean(pendingId) && pendingId === item.toolCall.id
    const view = createActionMessageView({
      approvalRequest: needsApproval ? pendingApproval : null,
      copy,
      presentation: "grouped",
      result: result?.content,
      toolCall: item.toolCall
    })

    return {
      item,
      key: item.key,
      kind: "tool",
      needsApproval,
      result,
      view
    }
  })
  const hasActiveActions = actionViews.some(isActivityViewPending)
  const hasLoadingActions = actionViews.some(isActivityViewLoading)
  const isOpen = open ?? openOverride ?? defaultOpen
  const latestActiveAction = [...actionViews].reverse().find(isActivityViewPending)
  const latestToolAction = [...actionViews].reverse().find((item) => item.kind === "tool")
  const latestActivity = actionViews[actionViews.length - 1]
  const headerAction = hasActiveActions ? latestActiveAction : latestToolAction
  const headerToolAction = headerAction?.kind === "tool" ? headerAction : null
  const latestThinkingActivity = latestActivity?.kind === "thinking" ? latestActivity : null
  const headerTitle =
    (headerToolAction && preferLatestToolSummary && hasActiveActions
      ? isOpen
        ? copy.chat.agentWorking
        : headerToolAction.view.summary
      : null) ??
    headerToolAction?.view.summary ??
    (latestThinkingActivity?.streaming ? copy.chat.agentThought : null) ??
    copy.chat.executedSteps(items.length)
  const headerStatusMeta =
    !isOpen && hasActiveActions && headerToolAction ? (
      <ToolStatusIndicator
        runningLabel={copy.common.running}
        status={headerToolAction.view.status}
        statusLabel={headerToolAction.view.statusLabel}
      />
    ) : null

  return (
    <AgentToolGroup
      active={hasLoadingActions}
      onOpenChange={onOpenChange ?? setOpenOverride}
      open={isOpen}
    >
      <AgentToolGroupTrigger
        className="[font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
        {...(headerToolAction
          ? { "data-tool-call-toggle": headerToolAction.item.toolCall.name }
          : {})}
        meta={headerStatusMeta}
      >
        {headerTitle}
      </AgentToolGroupTrigger>
      <AgentToolGroupContent className="ow-agent-activity-group-content space-y-[var(--ow-space-2)]">
        {actionViews.map((action) => {
          if (action.kind === "thinking") {
            return (
              <AgentToolGroupItem
                className="ow-agent-activity-thinking-item"
                icon={<span aria-hidden="true" className="size-[var(--ow-icon-sm)]" />}
                key={action.key}
              >
                <ThinkingActivityContent item={action.item} streaming={action.streaming} />
              </AgentToolGroupItem>
            )
          }

          const Icon = action.view.icon

          return (
            <AgentToolGroupItem
              className="ow-agent-activity-tool-item"
              icon={<Icon className="size-[var(--ow-icon-sm)]" />}
              key={action.key}
            >
              <ActionMessage
                approvalRequest={action.needsApproval ? pendingApproval : null}
                presentation="grouped"
                result={action.result?.content}
                toolCall={action.item.toolCall}
              />
            </AgentToolGroupItem>
          )
        })}
      </AgentToolGroupContent>
    </AgentToolGroup>
  )
}

function AssistantActivityCluster(props: {
  expanded?: boolean
  isStreaming: boolean
  items: AgentActivityItem[]
  preferLatestToolSummary?: boolean
  onExpandedChange?: (expanded: boolean) => void
  pendingApproval?: HITLRequest | null
  streamingAssistantId: string | null
  toolResults: Map<string, ToolResultInfo>
}): React.JSX.Element | null {
  const {
    expanded,
    isStreaming,
    items,
    onExpandedChange,
    pendingApproval,
    preferLatestToolSummary,
    streamingAssistantId,
    toolResults
  } = props
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null)
  const handleExpandedChange = onExpandedChange ?? setExpandedOverride
  const isExpanded = expanded ?? expandedOverride ?? false

  if (items.length === 0) {
    return null
  }

  if (items.length === 1) {
    const item = items[0]

    return (
      <Message className="max-w-full" from="assistant">
        <MessageContent className="w-full gap-[var(--ow-space-2-5)]">
          {item.kind === "tool" ? (
            <ActionMessage
              approvalRequest={
                pendingApproval?.tool_call?.id === item.toolCall.id ? pendingApproval : null
              }
              expanded={isExpanded}
              onExpandedChange={handleExpandedChange}
              result={toolResults.get(item.toolCall.id)?.content}
              toolCall={item.toolCall}
            />
          ) : (
            <ReasoningBlock
              isStreaming={isThinkingItemStreaming(item, { isStreaming, streamingAssistantId })}
              text={item.text}
            />
          )}
        </MessageContent>
      </Message>
    )
  }

  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent className="w-full gap-[var(--ow-gap-md)]">
        <AgentActivityGroup
          defaultOpen={false}
          isStreaming={isStreaming}
          items={items}
          onOpenChange={handleExpandedChange}
          open={isExpanded}
          pendingApproval={pendingApproval}
          preferLatestToolSummary={preferLatestToolSummary}
          streamingAssistantId={streamingAssistantId}
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
    includeReasoning: false,
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
          <div className="space-y-[var(--ow-space-3)]">{content.textContent}</div>
        ) : null}
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
        <MessageContent className="gap-[var(--ow-space-2-5)]">{content.textContent}</MessageContent>
      ) : null}
    </Message>
  )
}

const MessageTurnView = memo(function MessageTurnView(props: {
  isActiveTurn: boolean
  onBranch?: (messageId: string) => Promise<void> | void
  onRetry?: () => Promise<void> | void
  pendingApproval?: HITLRequest | null
  isStreaming: boolean
  streamingAssistantId: string | null
  activityExpansionOverrides: ReadonlyMap<string, boolean>
  toolResults: Map<string, ToolResultInfo>
  turn: MessageTurn
  onActivityExpansionChange: (turnKey: string, key: string, expanded: boolean) => void
}): React.JSX.Element {
  const { copy } = useI18n()
  const {
    isActiveTurn,
    isStreaming,
    onBranch,
    onRetry,
    pendingApproval,
    streamingAssistantId,
    activityExpansionOverrides,
    toolResults,
    turn,
    onActivityExpansionChange
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
    <div className="space-y-[var(--ow-space-2-5)]">
      {turn.user ? <UserMessage message={turn.user} /> : null}
      {assistantEntries.map((entry) => {
        if (entry.kind === "assistant-content") {
          return (
            <AssistantBlock
              isLastAssistant={entry.message.id === streamingAssistantId}
              isLoading={isStreaming}
              key={entry.key}
              message={entry.message}
            />
          )
        }

        return (
          <AssistantActivityCluster
            expanded={activityExpansionOverrides.get(entry.key)}
            isStreaming={isStreaming}
            items={entry.items}
            key={entry.key}
            onExpandedChange={(expanded) =>
              onActivityExpansionChange(turn.key, entry.key, expanded)
            }
            pendingApproval={pendingApproval}
            preferLatestToolSummary={toolDisplayPolicy.preferLatestSummary}
            streamingAssistantId={streamingAssistantId}
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
  const virtualRowPadding = "pb-[var(--ow-chat-turn-gap)]"
  const activeTurn = activeTurnKey ? turns.find((turn) => turn.key === activeTurnKey) : null
  const activeAssistant = activeTurn?.assistants.find((message) => message.id === lastAssistantId)
  const activeContentSignature = getStreamingTurnSignature(activeTurn, activeAssistant)
  const lastTurnKey = turns[turns.length - 1]?.key ?? "__empty__"
  const bottomSpacerHeight = `calc(${bottomInset}px + ${contentInsetY})`
  const [activityExpansionOverridesByTurn, setActivityExpansionOverridesByTurn] = useState<
    Map<string, ReadonlyMap<string, boolean>>
  >(() => new Map())
  const handleActivityExpansionChange = useCallback(
    (turnKey: string, key: string, expanded: boolean) => {
      setActivityExpansionOverridesByTurn((current) => {
        const currentTurnOverrides = current.get(turnKey) ?? EMPTY_ACTIVITY_EXPANSION_OVERRIDES
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
  const getTurnActivityExpansionOverrides = useCallback(
    (turn: MessageTurn): ReadonlyMap<string, boolean> =>
      activityExpansionOverridesByTurn.get(turn.key) ?? EMPTY_ACTIVITY_EXPANSION_OVERRIDES,
    [activityExpansionOverridesByTurn]
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
        isActiveTurn={isActiveTurn}
        isStreaming={isStreaming}
        key={turn.key}
        onBranch={isLoading ? undefined : onBranch}
        onRetry={isActiveTurn && !isLoading ? onRetry : undefined}
        pendingApproval={turnPendingApproval}
        streamingAssistantId={streamingAssistantId}
        activityExpansionOverrides={getTurnActivityExpansionOverrides(turn)}
        toolResults={turn.toolResults}
        turn={turn}
        onActivityExpansionChange={handleActivityExpansionChange}
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
