import {
  ChevronRight,
  Edit,
  FileText,
  FolderOpen,
  GitForkIcon,
  Lightbulb,
  MessageCircle,
  RefreshCcwIcon,
  Search,
  Terminal,
  TriangleAlert
} from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import {
  extractComposerMessageRefsMetadata,
  extractMessageText,
  hasComposerMessageInputContent,
  hasMessageContent,
  resolveImageBlockUrl,
  toComposerMessageInput,
  type ComposerMessageInput
} from "@shared/message-content"
import type { ContentBlock, HITLRequest, Message as ThreadMessage } from "@/types"
import type { EditLastUserMessageAndInvokeInput } from "@/lib/agent-control"
import { ActionMessage } from "./ActionMessage"
import {
  AgentActivityRow,
  AgentToolGroup,
  AgentToolGroupContent,
  AgentToolGroupTrigger
} from "@/components/agent-ui"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { createActionMessageView } from "./action-message-view"
import {
  projectAgentActivityFallbackHeaderText,
  projectAgentActivityHeaderSummary,
  type AgentActivitySummaryIcon
} from "./agent-activity-summary"
import { useI18n } from "@/lib/i18n"
import { cn, formatTime } from "@/lib/utils"
import {
  buildTurnAssistantEntries,
  getTurnCopyText,
  projectActiveTurnStatus,
  projectTurnElapsedDivider,
  type AgentActivityItem,
  type ActiveTurnStatusProjection,
  type MessageTurn,
  type ToolResultInfo,
  type TurnElapsedProjection
} from "@/lib/message-projection"
import type { AgentToolExecutionView, AgentToolExecutionsView } from "@/lib/message-projection"
import type { ActiveAgentToolCall, AgentRunPhase } from "@shared/agent-thread-runtime"
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
import { CopyButton } from "../ui/button"
import { AssistantSelectionReferencesFromMetadata } from "./AssistantSelectionReferences"
import { getAssistantSelectionRefs } from "./useAssistantSelectionRefs"
import { useThreadControl } from "@/lib/thread-context"
import type { RunCoachTipProjection } from "@/lib/run-coach"

interface StructuredMessageContent {
  attachments: React.ReactNode
  reasoningContent: React.ReactNode
  textContent: React.ReactNode
}

const USER_MESSAGE_COLLAPSED_LINE_COUNT = 20
const USER_MESSAGE_COLLAPSE_EPSILON_PX = 1
const USER_MESSAGE_FALLBACK_FONT_SIZE_PX = 12
const USER_MESSAGE_FALLBACK_LINE_HEIGHT_MULTIPLIER = 1.5
const USER_MESSAGE_COLLAPSED_STYLE: CSSProperties = {
  display: "-webkit-box",
  maxHeight: `${USER_MESSAGE_COLLAPSED_LINE_COUNT}lh`,
  overflow: "hidden",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: USER_MESSAGE_COLLAPSED_LINE_COUNT
}

interface UserTextMeasurement {
  collapsedHeightPx: number
  contentHeightPx: number
  lineHeightPx: number
  text: string
  widthPx: number
}

function getWorkspaceFileName(path: string): string {
  return path.split("/").pop() || path
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

function getUserTextLineHeightPx(element: HTMLElement): number {
  const styles = window.getComputedStyle(element)
  const lineHeightPx = Number.parseFloat(styles.lineHeight)

  if (Number.isFinite(lineHeightPx)) {
    return lineHeightPx
  }

  const fontSizePx = Number.parseFloat(styles.fontSize)
  const fallbackFontSizePx = Number.isFinite(fontSizePx)
    ? fontSizePx
    : USER_MESSAGE_FALLBACK_FONT_SIZE_PX
  return fallbackFontSizePx * USER_MESSAGE_FALLBACK_LINE_HEIGHT_MULTIPLIER
}

function measureUserTextBlock(element: HTMLDivElement, text: string): UserTextMeasurement | null {
  const widthPx = Math.floor(element.getBoundingClientRect().width)

  if (widthPx <= 0) {
    return null
  }

  const lineHeightPx = getUserTextLineHeightPx(element)

  return {
    collapsedHeightPx: Math.ceil(lineHeightPx * USER_MESSAGE_COLLAPSED_LINE_COUNT),
    contentHeightPx: Math.ceil(element.scrollHeight),
    lineHeightPx,
    text,
    widthPx
  }
}

function isSameUserTextMeasurement(
  previous: UserTextMeasurement | null,
  next: UserTextMeasurement | null
): boolean {
  return (
    previous?.collapsedHeightPx === next?.collapsedHeightPx &&
    previous?.contentHeightPx === next?.contentHeightPx &&
    previous?.lineHeightPx === next?.lineHeightPx &&
    previous?.text === next?.text &&
    previous?.widthPx === next?.widthPx
  )
}

function useUserTextCollapse(text: string): {
  collapseState: "collapsed" | "expanded" | "uncollapsible"
  setTextRef: (node: HTMLDivElement | null) => void
  toggleExpansion: () => void
} {
  const textElementRef = useRef<HTMLDivElement | null>(null)
  const [measurement, setMeasurement] = useState<UserTextMeasurement | null>(null)
  const [expandedText, setExpandedText] = useState<string | null>(null)

  const measure = useCallback((): void => {
    const element = textElementRef.current

    if (!element) {
      return
    }

    const next = measureUserTextBlock(element, text)
    setMeasurement((previous) => (isSameUserTextMeasurement(previous, next) ? previous : next))
  }, [text])

  const setTextRef = useCallback((node: HTMLDivElement | null): void => {
    textElementRef.current = node
  }, [])

  useEffect(() => {
    const element = textElementRef.current

    if (!element || typeof ResizeObserver === "undefined") {
      return undefined
    }

    let frameId: number | null = null
    const scheduleMeasure = (): void => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null
        measure()
      })
    }
    const observer = new ResizeObserver(scheduleMeasure)

    scheduleMeasure()
    observer.observe(element)

    return () => {
      observer.disconnect()
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [measure])

  const isMeasuredText = measurement?.text === text
  const isCollapsible = Boolean(
    isMeasuredText &&
      measurement &&
      measurement.contentHeightPx > measurement.collapsedHeightPx + USER_MESSAGE_COLLAPSE_EPSILON_PX
  )
  const isExpanded = expandedText === text
  const collapseState = !isCollapsible ? "uncollapsible" : isExpanded ? "expanded" : "collapsed"
  const toggleExpansion = useCallback((): void => {
    setExpandedText((current) => (current === text ? null : text))
  }, [text])

  return {
    collapseState,
    setTextRef,
    toggleExpansion
  }
}

function UserTextBlock(props: {
  onOpenWorkspaceFile?: (path: string) => void
  text: string
}): React.JSX.Element {
  const { copy } = useI18n()
  const { onOpenWorkspaceFile, text } = props
  const { collapseState, setTextRef, toggleExpansion } = useUserTextCollapse(text)
  const isCollapsed = collapseState === "collapsed"
  const isExpanded = collapseState === "expanded"

  return (
    <div className="flex min-w-0 flex-col items-start">
      <div
        ref={setTextRef}
        className="whitespace-pre-wrap [overflow-wrap:anywhere] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
        style={isCollapsed ? USER_MESSAGE_COLLAPSED_STYLE : undefined}
      >
        <ExtensionSourceTextViewer onOpenWorkspaceFile={onOpenWorkspaceFile} text={text} />
      </div>
      {collapseState !== "uncollapsible" ? (
        <button
          type="button"
          aria-expanded={isExpanded}
          className="mt-[var(--ow-space-1)] inline-flex cursor-pointer items-center gap-[var(--ow-gap-xs)] self-start text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [font-size:var(--ow-font-body)]"
          onClick={toggleExpansion}
        >
          <span>{isExpanded ? copy.chat.userMessageShowLess : copy.chat.userMessageShowMore}</span>
          <ChevronRight
            className={cn(
              "size-[var(--ow-icon-xs)] transition-transform",
              isExpanded ? "-rotate-90" : "rotate-90"
            )}
          />
        </button>
      ) : null}
    </div>
  )
}

function renderTextBlock(
  text: string,
  options: {
    isStreaming?: boolean
    isUser: boolean
    key: string
    onOpenWorkspaceFile?: (path: string) => void
  }
): React.JSX.Element | null {
  const { isStreaming, isUser, key, onOpenWorkspaceFile } = options

  if (!text.trim()) {
    return null
  }

  if (isUser) {
    return <UserTextBlock key={key} onOpenWorkspaceFile={onOpenWorkspaceFile} text={text} />
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

function ReasoningBlock(props: { isStreaming?: boolean; text: string }): React.JSX.Element | null {
  const { copy } = useI18n()
  const { isStreaming, text } = props
  const [openOverride, setOpenOverride] = useState<boolean | null>(null)

  if (!text.trim()) {
    return null
  }

  const title = isStreaming ? copy.chat.agentStatusThinking : copy.chat.agentThought
  const isOpen = openOverride ?? Boolean(isStreaming)

  return (
    <Collapsible
      className="ow-reasoning-message"
      data-active={isStreaming ? "true" : "false"}
      onOpenChange={setOpenOverride}
      open={isOpen}
    >
      <CollapsibleTrigger className="ow-reasoning-trigger group w-full min-w-0 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <AgentActivityRow
          active={isStreaming}
          className="w-full"
          icon={<MessageCircle className="size-[var(--ow-icon-sm)]" />}
          label={title}
          labelClassName="ow-reasoning-title truncate"
          trailing={
            <ChevronRight className="ow-reasoning-chevron size-[var(--ow-icon-sm)] shrink-0 text-[var(--ow-agent-timeline-muted)]" />
          }
          trailingPlacement="inline"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="ow-reasoning-content ow-agent-tool-content overflow-hidden">
        <div className="mt-[var(--ow-space-1)] min-w-0 max-w-full pl-[calc(var(--ow-icon-action)+var(--ow-gap-sm))] whitespace-pre-wrap [overflow-wrap:anywhere] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function renderStructuredContent(
  content: ThreadMessage["content"],
  options: {
    includeReasoning?: boolean
    isStreaming?: boolean
    isUser: boolean
    onOpenWorkspaceFile?: (path: string) => void
  }
): StructuredMessageContent {
  const { includeReasoning = true, isStreaming, isUser, onOpenWorkspaceFile } = options

  if (typeof content === "string") {
    return {
      attachments: null,
      reasoningContent: null,
      textContent: renderTextBlock(content, {
        isStreaming,
        isUser,
        key: "message-content",
        onOpenWorkspaceFile
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
        key: `${block.type}-${index}`,
        onOpenWorkspaceFile
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

type ToolActivityView = {
  activeToolCall?: ActiveAgentToolCall
  approvalRequest: HITLRequest | null
  execution: AgentToolExecutionView | undefined
  item: Extract<AgentActivityItem, { kind: "tool" }>
  key: string
  kind: "tool"
  result: ToolResultInfo | undefined
  status: ProjectedToolActivityStatus
  view: ReturnType<typeof createActionMessageView>
}

type ActivityView = ToolActivityView
type ProjectedToolActivityStatus =
  | "approval"
  | "arguments_streaming"
  | "complete"
  | "failed"
  | "running"
  | "waiting_result"

const ACTIVE_TURN_STATUS_ELAPSED_THRESHOLD_MS = 3_000

function getAgentActivitySummaryIcon(kind: AgentActivitySummaryIcon): React.JSX.Element {
  switch (kind) {
    case "command":
      return <Terminal className="size-[var(--ow-icon-action)]" />
    case "file":
      return <FileText className="size-[var(--ow-icon-action)]" />
    case "folder":
      return <FolderOpen className="size-[var(--ow-icon-action)]" />
    case "pencil":
      return <Edit className="size-[var(--ow-icon-action)]" />
    case "search":
      return <Search className="size-[var(--ow-icon-action)]" />
  }
}

function toAgentActivitySummaryTool(action: ToolActivityView) {
  return {
    status: action.status,
    toolCall: action.item.toolCall
  }
}

function isActivityViewPending(action: ActivityView): boolean {
  return action.status !== "complete" && action.status !== "failed"
}

function isActivityViewLoading(action: ActivityView): boolean {
  return (
    action.status === "arguments_streaming" ||
    action.status === "running" ||
    action.status === "waiting_result"
  )
}

function projectToolActivityStatus(input: {
  approvalRequest: HITLRequest | null
  execution: AgentToolExecutionView | undefined
  result: ToolResultInfo | undefined
}): ProjectedToolActivityStatus {
  if (input.approvalRequest) {
    return "approval"
  }

  return input.execution?.status ?? "complete"
}

function projectToolActivityView(input: {
  copy: ReturnType<typeof useI18n>["copy"]
  item: Extract<AgentActivityItem, { kind: "tool" }>
  pendingApproval: HITLRequest | null | undefined
  toolExecutions: AgentToolExecutionsView
  toolResults: Map<string, ToolResultInfo>
}): ToolActivityView {
  const approvalRequest =
    input.pendingApproval?.tool_call?.id === input.item.toolCall.id ? input.pendingApproval : null
  const execution = input.toolExecutions[input.item.toolCall.id]
  const result = input.toolResults.get(input.item.toolCall.id)
  const status = projectToolActivityStatus({ approvalRequest, execution, result })
  const view = createActionMessageView({
    approvalRequest,
    copy: input.copy,
    presentation: "grouped",
    result: result?.content,
    status,
    toolCall: input.item.toolCall
  })

  return {
    activeToolCall: execution?.activeToolCall,
    approvalRequest,
    execution,
    item: input.item,
    key: input.item.key,
    kind: "tool",
    result,
    status,
    view
  }
}

function AgentActivityGroup(props: {
  activeThinking?: boolean
  defaultOpen?: boolean
  items: AgentActivityItem[]
  onOpenChange?: (open: boolean) => void
  open?: boolean
  pendingApproval?: HITLRequest | null
  toolExecutions: AgentToolExecutionsView
  toolResults: Map<string, ToolResultInfo>
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const {
    activeThinking = false,
    defaultOpen = false,
    items,
    onOpenChange,
    open,
    pendingApproval,
    toolExecutions,
    toolResults
  } = props
  const [openOverride, setOpenOverride] = useState<boolean | null>(null)

  const actionViews: ActivityView[] = useMemo(
    () =>
      items.map(
        (item): ActivityView =>
          projectToolActivityView({
            copy,
            item,
            pendingApproval,
            toolExecutions,
            toolResults
          })
      ),
    [copy, items, pendingApproval, toolExecutions, toolResults]
  )

  if (items.length === 0) {
    return null
  }
  const hasActiveActions = actionViews.some(isActivityViewPending)
  const hasLoadingActions = actionViews.some(isActivityViewLoading)
  const hasApprovalActions = actionViews.some((action) => action.status === "approval")
  const isOpen = open ?? openOverride ?? defaultOpen
  const latestActiveAction = [...actionViews].reverse().find(isActivityViewPending)
  const latestToolAction = [...actionViews].reverse().find((item) => item.kind === "tool")
  const headerAction = hasActiveActions ? latestActiveAction : latestToolAction
  const headerToolAction = headerAction?.kind === "tool" ? headerAction : null
  const headerSummary = projectAgentActivityHeaderSummary(
    copy,
    actionViews.map(toAgentActivitySummaryTool)
  )
  const fallbackHeaderText = projectAgentActivityFallbackHeaderText(copy, {
    hasApprovalActions,
    hasLoadingActions,
    itemsLength: items.length
  })
  const headerTitle = activeThinking
    ? copy.chat.agentStatusThinking
    : (headerSummary?.title ?? fallbackHeaderText.title)
  const headerDetail = activeThinking ? null : (headerSummary?.detail ?? fallbackHeaderText.detail)
  const headerTextActive = activeThinking || hasLoadingActions
  const headerIcon = headerSummary ? getAgentActivitySummaryIcon(headerSummary.icon) : undefined

  return (
    <AgentToolGroup
      active={activeThinking || hasLoadingActions}
      onOpenChange={onOpenChange ?? setOpenOverride}
      open={isOpen}
    >
      <AgentToolGroupTrigger
        active={headerTextActive}
        className="[font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
        detail={headerDetail}
        icon={headerIcon}
        {...(headerToolAction
          ? { "data-tool-call-toggle": headerToolAction.item.toolCall.name }
          : {})}
      >
        {headerTitle}
      </AgentToolGroupTrigger>
      <AgentToolGroupContent className="ow-agent-activity-group-content space-y-[var(--ow-space-2)]">
        {actionViews.map((action) => {
          return (
            <div className="ow-agent-activity-tool-item" key={action.key}>
              <ActionMessage
                activeToolCall={action.activeToolCall}
                approvalRequest={action.approvalRequest}
                durationMs={action.execution?.execution?.durationMs}
                fileMutationResult={action.result?.fileMutation}
                presentation="grouped"
                result={action.result?.content}
                status={action.status}
                toolCall={action.item.toolCall}
              />
            </div>
          )
        })}
      </AgentToolGroupContent>
    </AgentToolGroup>
  )
}

function AssistantActivityCluster(props: {
  activeThinking?: boolean
  items: AgentActivityItem[]
  pendingApproval?: HITLRequest | null
  toolExecutions: AgentToolExecutionsView
  toolResults: Map<string, ToolResultInfo>
}): React.JSX.Element | null {
  const { activeThinking = false, items, pendingApproval, toolExecutions, toolResults } = props
  const { copy } = useI18n()
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null)
  const isExpanded = expandedOverride ?? false
  const handleExpandedChange = useCallback((open: boolean): void => {
    setExpandedOverride(open)
  }, [])

  if (items.length === 0) {
    return null
  }

  if (items.length === 1) {
    const item = items[0]

    if (item.kind === "tool") {
      const toolActivity = projectToolActivityView({
        copy,
        item,
        pendingApproval,
        toolExecutions,
        toolResults
      })
      const headerSummary = projectAgentActivityHeaderSummary(copy, [
        toAgentActivitySummaryTool(toolActivity)
      ])

      if (!isActivityViewPending(toolActivity) && headerSummary) {
        return (
          <Message className="max-w-full" from="assistant">
            <MessageContent className="w-full gap-[var(--ow-gap-md)]">
              <AgentActivityGroup
                activeThinking={activeThinking}
                defaultOpen={false}
                items={items}
                onOpenChange={handleExpandedChange}
                open={isExpanded}
                pendingApproval={pendingApproval}
                toolExecutions={toolExecutions}
                toolResults={toolResults}
              />
            </MessageContent>
          </Message>
        )
      }

      return (
        <Message className="max-w-full" from="assistant">
          <MessageContent className="w-full gap-[var(--ow-space-2-5)]">
            <ActionMessage
              activeToolCall={toolActivity.activeToolCall}
              approvalRequest={toolActivity.approvalRequest}
              durationMs={toolActivity.execution?.execution?.durationMs}
              expanded={isExpanded}
              fileMutationResult={toolActivity.result?.fileMutation}
              onExpandedChange={handleExpandedChange}
              result={toolActivity.result?.content}
              status={toolActivity.status}
              toolCall={toolActivity.item.toolCall}
            />
          </MessageContent>
        </Message>
      )
    }
  }

  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent className="w-full gap-[var(--ow-gap-md)]">
        <AgentActivityGroup
          activeThinking={activeThinking}
          defaultOpen={false}
          items={items}
          onOpenChange={handleExpandedChange}
          open={isExpanded}
          pendingApproval={pendingApproval}
          toolExecutions={toolExecutions}
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
    <Message
      className="max-w-full"
      data-assistant-message-id={message.id}
      data-assistant-selection-source="true"
      from="assistant"
    >
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

function isActiveTurnStatusShimmering(kind: ActiveTurnStatusProjection["kind"]): boolean {
  return kind === "thinking"
}

function formatActiveTurnElapsedTime(ms: number): string {
  const seconds = ms / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }

  const totalSeconds = Math.floor(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

function formatTurnElapsedTime(ms: number): string {
  const totalSeconds = Math.max(1, Math.floor(ms / 1000))
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

function TurnElapsedDivider(props: { projection: TurnElapsedProjection }): React.JSX.Element {
  const { projection } = props
  const { copy } = useI18n()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (projection.status !== "working") {
      return undefined
    }

    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [projection.status])

  const elapsed =
    projection.status === "working"
      ? Math.max(0, now - new Date(projection.startedAt).getTime())
      : projection.durationMs
  const label =
    projection.status === "working"
      ? elapsed >= 1000
        ? copy.chat.turnWorkingFor(formatTurnElapsedTime(elapsed))
        : copy.chat.turnWorking
      : copy.chat.turnWorkedFor(formatTurnElapsedTime(elapsed))

  return (
    <div className="flex items-center gap-[var(--ow-gap-sm)] py-[var(--ow-space-1)] text-[var(--ow-agent-timeline-muted)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]">
      <span className="shrink-0 tabular-nums">{label}</span>
      <span className="h-px min-w-0 flex-1 bg-border/70" />
    </div>
  )
}

function ActiveTurnStatusElapsed(props: {
  active: boolean
  startedAt?: Date | null
}): React.JSX.Element | null {
  const { active, startedAt } = props
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) {
      return undefined
    }

    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 250)

    return () => {
      window.clearInterval(timer)
    }
  }, [active])

  if (!active || !startedAt) {
    return null
  }

  const startedAtMs = new Date(startedAt).getTime()
  const elapsed = Math.max(0, now - startedAtMs)
  if (elapsed < ACTIVE_TURN_STATUS_ELAPSED_THRESHOLD_MS) {
    return null
  }

  return (
    <span className="shrink-0 text-[var(--ow-agent-timeline-muted)] [font-size:var(--ow-font-caption)] tabular-nums">
      {formatActiveTurnElapsedTime(elapsed)}
    </span>
  )
}

function RunCoachTip(props: { tip: RunCoachTipProjection | null }): React.JSX.Element | null {
  const { copy } = useI18n()
  const { tip } = props

  if (!tip) {
    return null
  }

  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-[var(--ow-gap-xs)] truncate text-[var(--ow-agent-timeline-muted)]"
      data-run-coach-tip={tip.id}
    >
      <Lightbulb className="size-[var(--ow-icon-xs)] shrink-0" />
      <span className="min-w-0 truncate">{copy.chat.runCoachTip[tip.id]}</span>
    </span>
  )
}

function ActiveTurnStatusRow(props: {
  activeToolCalls: readonly ActiveAgentToolCall[]
  phaseStartedAt?: Date | null
  status: ActiveTurnStatusProjection
}): React.JSX.Element {
  const { copy } = useI18n()
  const { activeToolCalls, phaseStartedAt, status } = props
  const isShimmering = isActiveTurnStatusShimmering(status.kind)
  const startedAt =
    status.toolCallId !== null
      ? (activeToolCalls.find((toolCall) => toolCall.id === status.toolCallId)?.startedAt ??
        phaseStartedAt)
      : phaseStartedAt
  const shouldShowElapsed = status.kind !== "waiting_approval"
  const title =
    status.kind === "waiting_approval"
      ? copy.chat.agentStatusWaitingApproval
      : copy.chat.agentStatusThinking

  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent className="w-full gap-[var(--ow-space-2-5)]">
        <AgentActivityRow
          active={isShimmering}
          className="w-full text-[var(--ow-agent-timeline-muted)]"
          data-active-turn-status={status.kind}
          icon={
            status.kind === "waiting_approval" ? (
              <TriangleAlert className="size-[var(--ow-icon-action)] text-status-warning" />
            ) : (
              <MessageCircle className="size-[var(--ow-icon-sm)]" />
            )
          }
          detail={<RunCoachTip tip={status.coachTip} />}
          detailClassName="max-w-[min(36rem,52vw)]"
          label={title}
          meta={<ActiveTurnStatusElapsed active={shouldShowElapsed} startedAt={startedAt} />}
          role="status"
        />
      </MessageContent>
    </Message>
  )
}

function UserMessage(props: {
  editInput?: ComposerMessageInput | null
  message: ThreadMessage
  onSubmitEdit?: (input: EditLastUserMessageAndInvokeInput) => Promise<boolean> | boolean
  threadId: string
}): React.JSX.Element | null {
  const { editInput, message, onSubmitEdit, threadId } = props
  const { copy, locale } = useI18n()
  const [editingInput, setEditingInput] = useState<ComposerMessageInput | null>(null)
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)
  const threadControl = useThreadControl(threadId)
  const handleOpenWorkspaceFile = useCallback(
    (path: string): void => {
      threadControl?.local.openFile(path, getWorkspaceFileName(path))
    },
    [threadControl]
  )
  const content = renderStructuredContent(message.content, {
    isUser: true,
    onOpenWorkspaceFile: handleOpenWorkspaceFile
  })
  const hasReferences =
    getAssistantSelectionRefs(extractComposerMessageRefsMetadata(message.metadata)).length > 0
  const canEdit = Boolean(editInput && onSubmitEdit)
  const isEditing = canEdit && editingInput !== null
  const editIsSubmittable = editingInput ? hasComposerMessageInputContent(editingInput) : false
  const copyText = extractMessageText(message.content)
  const canCopy = copyText.trim().length > 0
  const hasActions = canCopy || canEdit
  const createdAtLabel = formatTime(message.created_at, locale)

  const startEditing = useCallback((): void => {
    if (!editInput || !onSubmitEdit) {
      return
    }

    setEditingInput({
      refs: editInput.refs,
      text: editInput.text
    })
  }, [editInput, onSubmitEdit])
  const cancelEditing = useCallback((): void => {
    setEditingInput(null)
  }, [])
  const submitEdit = useCallback(async (): Promise<void> => {
    if (!canEdit || !editIsSubmittable || !editingInput || !onSubmitEdit || isSubmittingEdit) {
      return
    }

    setIsSubmittingEdit(true)
    try {
      const didSubmit = await onSubmitEdit({
        messageId: message.id,
        messageInput: editingInput
      })
      if (didSubmit) {
        setEditingInput(null)
      }
    } finally {
      setIsSubmittingEdit(false)
    }
  }, [canEdit, editIsSubmittable, editingInput, isSubmittingEdit, message.id, onSubmitEdit])

  if (!content.attachments && !content.textContent && !hasReferences) {
    return null
  }

  if (isEditing) {
    return (
      <Message from="user">
        {hasReferences ? (
          <AssistantSelectionReferencesFromMetadata
            className="ml-auto justify-end"
            metadata={message.metadata}
          />
        ) : null}
        {content.attachments}
        <form
          className="ml-auto flex w-full max-w-full flex-col gap-[var(--ow-space-3)] rounded-[var(--ow-radius-md)] bg-secondary px-[var(--ow-message-bubble-x)] py-[var(--ow-message-bubble-y)] text-foreground"
          onSubmit={(event) => {
            event.preventDefault()
            void submitEdit()
          }}
        >
          <textarea
            aria-label={copy.chat.editUserMessage}
            autoFocus
            className="min-h-[7rem] w-full resize-y bg-transparent [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-foreground outline-none placeholder:text-muted-foreground"
            disabled={isSubmittingEdit}
            onChange={(event) => {
              const text = event.currentTarget.value
              setEditingInput((current) => (current ? { ...current, text } : current))
            }}
            value={editingInput.text}
          />
          <div className="flex items-center justify-end gap-[var(--ow-gap-sm)]">
            <button
              className="inline-flex h-[var(--ow-control-h-md)] items-center justify-center rounded-[var(--ow-radius-sm)] bg-background-elevated px-[var(--ow-space-3)] [font-size:var(--ow-font-meta)] text-muted-foreground transition hover:bg-background-interactive hover:text-foreground disabled:opacity-50"
              disabled={isSubmittingEdit}
              onClick={cancelEditing}
              type="button"
            >
              {copy.chat.cancelEditMessage}
            </button>
            <button
              className="inline-flex h-[var(--ow-control-h-md)] items-center justify-center rounded-[var(--ow-radius-sm)] bg-primary px-[var(--ow-space-3)] [font-size:var(--ow-font-meta)] text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              disabled={isSubmittingEdit || !editIsSubmittable}
              type="submit"
            >
              {copy.chat.sendEditedMessage}
            </button>
          </div>
        </form>
      </Message>
    )
  }

  return (
    <Message from="user">
      {hasReferences ? (
        <AssistantSelectionReferencesFromMetadata
          className="ml-auto justify-end"
          metadata={message.metadata}
        />
      ) : null}
      {content.attachments}
      {content.textContent ? (
        <MessageContent className="gap-[var(--ow-space-2-5)]">{content.textContent}</MessageContent>
      ) : null}
      {hasActions ? (
        <MessageToolbar className="-mt-[var(--ow-space-1)] ml-auto justify-end">
          <MessageActions className="h-[var(--ow-control-h-compact)] rounded-[var(--ow-radius-sm)] border border-transparent px-[var(--ow-space-1)] text-muted-foreground">
            <span className="px-[var(--ow-space-1)] [font-size:var(--ow-font-meta)] tabular-nums">
              {createdAtLabel}
            </span>
            {canCopy ? (
              <MessageAction asChild label={copy.chat.copyMessage} tooltip={copy.chat.copyMessage}>
                <CopyButton
                  className="size-[22px] rounded-[var(--ow-radius-sm)] text-muted-foreground hover:text-foreground [&_svg]:size-[var(--ow-icon-sm)]"
                  copiedLabel={copy.common.copied}
                  copyLabel={copy.chat.copyMessage}
                  iconClassName="size-[var(--ow-icon-sm)]"
                  text={copyText}
                />
              </MessageAction>
            ) : null}
            {canEdit ? (
              <MessageAction
                label={copy.chat.editUserMessage}
                onClick={startEditing}
                tooltip={copy.chat.editUserMessage}
              >
                <Edit className="size-[var(--ow-icon-sm)]" />
              </MessageAction>
            ) : null}
          </MessageActions>
        </MessageToolbar>
      ) : null}
    </Message>
  )
}

export const MessageTurnView = memo(function MessageTurnView(props: {
  activeToolCalls: readonly ActiveAgentToolCall[]
  activePhaseStartedAt?: Date | null
  activeRunPhase?: AgentRunPhase | null
  activeRunStartedAt?: Date | null
  isActiveTurn: boolean
  onBranch?: (messageId: string) => Promise<void> | void
  onEditLastUserMessage?: (input: EditLastUserMessageAndInvokeInput) => Promise<boolean> | boolean
  onRetry?: (input: ComposerMessageInput) => Promise<void> | void
  pendingApproval?: HITLRequest | null
  isStreaming: boolean
  streamingAssistantId: string | null
  toolExecutions: AgentToolExecutionsView
  toolResults: Map<string, ToolResultInfo>
  turn: MessageTurn
  threadId: string
}): React.JSX.Element {
  const { copy } = useI18n()
  const {
    activeToolCalls,
    activePhaseStartedAt,
    activeRunPhase,
    activeRunStartedAt,
    isActiveTurn,
    isStreaming,
    onBranch,
    onEditLastUserMessage,
    onRetry,
    pendingApproval,
    streamingAssistantId,
    threadId,
    toolExecutions,
    toolResults,
    turn
  } = props
  const copyText = getTurnCopyText(turn)
  const hasAssistantMessages = turn.assistants.length > 0
  const shouldHideToolbar = isStreaming
  const retryInput =
    turn.user && hasMessageContent(turn.user.content)
      ? toComposerMessageInput(turn.user.content, turn.user.metadata)
      : null
  const handleSubmitUserEdit = useCallback(
    async (input: EditLastUserMessageAndInvokeInput): Promise<boolean> => {
      return (await onEditLastUserMessage?.(input)) ?? false
    },
    [onEditLastUserMessage]
  )
  const assistantEntries = useMemo(
    () => buildTurnAssistantEntries(turn, { activeToolCalls, streamingAssistantId }),
    [activeToolCalls, streamingAssistantId, turn]
  )
  const turnElapsed = useMemo(
    () =>
      projectTurnElapsedDivider({
        activeRunStartedAt,
        isStreaming,
        turn
      }),
    [activeRunStartedAt, isStreaming, turn]
  )
  const activeTurnStatus = useMemo(
    () =>
      projectActiveTurnStatus({
        activeRunPhase,
        assistantEntries,
        isStreaming,
        pendingApproval
      }),
    [activeRunPhase, assistantEntries, isStreaming, pendingApproval]
  )
  const activeTurnStatusRow = activeTurnStatus ? (
    <ActiveTurnStatusRow
      activeToolCalls={activeToolCalls}
      key={`${activeTurnStatus.kind}:${activeTurnStatus.toolCallId ?? "turn"}`}
      phaseStartedAt={activePhaseStartedAt}
      status={activeTurnStatus}
    />
  ) : null

  return (
    <div className="space-y-[var(--ow-space-2-5)]">
      {turn.user ? (
        <UserMessage
          editInput={onEditLastUserMessage ? retryInput : null}
          key={`${turn.user.id}:${onEditLastUserMessage ? "editable" : "read-only"}`}
          message={turn.user}
          onSubmitEdit={onEditLastUserMessage ? handleSubmitUserEdit : undefined}
          threadId={threadId}
        />
      ) : null}
      {turnElapsed ? <TurnElapsedDivider projection={turnElapsed} /> : null}
      {activeTurnStatus?.placement === "before_entries" ? activeTurnStatusRow : null}
      {assistantEntries.map((entry, index) => {
        const isLatestEntry = index === assistantEntries.length - 1
        if (entry.kind === "thinking") {
          return (
            <Message className="max-w-full" from="assistant" key={entry.key}>
              <MessageContent className="w-full gap-[var(--ow-space-2-5)]">
                <ReasoningBlock isStreaming={isStreaming && entry.isActive} text={entry.text} />
              </MessageContent>
            </Message>
          )
        }

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
            activeThinking={
              isLatestEntry && activeTurnStatus?.placement === "inside_latest_agent_activity"
            }
            items={entry.items}
            key={entry.key}
            pendingApproval={pendingApproval}
            toolExecutions={toolExecutions}
            toolResults={toolResults}
          />
        )
      })}
      {activeTurnStatus?.placement === "after_entries" ? activeTurnStatusRow : null}

      {hasAssistantMessages && !shouldHideToolbar ? (
        <MessageToolbar className="mt-0 justify-start">
          <MessageActions>
            {isActiveTurn && onRetry && retryInput && !isStreaming ? (
              <MessageAction
                label={copy.chat.retryMessage}
                onClick={() => void onRetry(retryInput)}
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
