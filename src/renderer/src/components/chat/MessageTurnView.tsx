import {
  ChevronRight,
  Edit,
  FileText,
  FolderOpen,
  GitForkIcon,
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
import type {
  JingleActiveRunCoachStatusKind,
  JingleRunCoachTipProjection
} from "@jingle/agent-react"
import type { JingleActiveAgentToolCall, JingleAgentRunPhase } from "@jingle/agent-client"
import { ActionMessage } from "./ActionMessage"
import { AssistantContentCards } from "./AssistantContentCards"
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
  type ActiveTurnStatusProjection,
  type AgentActivityItem,
  type MessageTurn,
  type ToolResultInfo,
  type TurnAssistantEntry,
  type TurnElapsedProjection
} from "@/lib/message-projection"
import type {
  AgentToolExecutionView,
  AgentToolExecutionViewStatus,
  AgentToolExecutionsView
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
} from "../attachments"
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
import { ContextEvidencePanel } from "./ContextEvidencePanel"
import { readJingleSteeringStatus } from "@shared/message-steering"

type AssistantProcessRenderEntry =
  | {
      entry: Extract<TurnAssistantEntry, { kind: "agent-activity" }>
      index: number
      kind: "agent-activity"
    }
  | {
      entry: Extract<TurnAssistantEntry, { kind: "assistant-content" }>
      index: number
      kind: "assistant-content"
    }
  | {
      entry: Extract<TurnAssistantEntry, { kind: "thinking" }>
      index: number
      kind: "thinking"
    }

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
      fallbackIcon: <FileText className="size-[var(--jingle-icon-display)] text-muted-foreground" />
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
        "w-fit max-w-full gap-[var(--jingle-gap-md)]",
        isUser ? "ml-auto justify-end" : "justify-start"
      )}
    >
      {attachments.map(({ data, fallbackIcon }) => (
        <AttachmentHoverCard key={data.id}>
          <AttachmentHoverCardTrigger asChild>
            <Attachment
              data={data}
              className={cn(
                "size-[var(--jingle-chat-attachment-image-size)] overflow-hidden rounded-[var(--jingle-chat-attachment-image-radius)] border-0 bg-background-secondary shadow-[0_8px_24px_rgba(0,0,0,0.14)]",
                "sm:size-[var(--jingle-chat-attachment-image-size-wide)]"
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
        className="whitespace-pre-wrap [overflow-wrap:anywhere] [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)]"
        style={isCollapsed ? USER_MESSAGE_COLLAPSED_STYLE : undefined}
      >
        <ExtensionSourceTextViewer onOpenWorkspaceFile={onOpenWorkspaceFile} text={text} />
      </div>
      {collapseState !== "uncollapsible" ? (
        <button
          type="button"
          aria-expanded={isExpanded}
          className="mt-[var(--jingle-space-1)] inline-flex cursor-pointer items-center gap-[var(--jingle-gap-xs)] self-start text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [font-size:var(--jingle-font-body)]"
          onClick={toggleExpansion}
        >
          <span>{isExpanded ? copy.chat.userMessageShowLess : copy.chat.userMessageShowMore}</span>
          <ChevronRight
            className={cn(
              "size-[var(--jingle-icon-xs)] transition-transform",
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
      className="min-w-0 [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)]"
      isAnimating={isStreaming}
    >
      {text}
    </MessageResponse>
  )
}

function getContentBlockDisplayText(block: ContentBlock): string {
  return block.text ?? block.content ?? ""
}

function getReasoningBlockText(block: ContentBlock): string {
  return block.reasoning ?? getContentBlockDisplayText(block)
}

function ReasoningBlock(props: {
  coachTip?: JingleRunCoachTipProjection | null
  isStreaming?: boolean
  text: string
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { coachTip = null, isStreaming, text } = props
  const [openOverride, setOpenOverride] = useState<boolean | null>(null)
  const hasText = text.trim().length > 0

  if (!hasText && !isStreaming) {
    return null
  }

  const title = isStreaming ? copy.chat.agentStatusThinking : copy.chat.agentThought
  const isOpen = openOverride ?? Boolean(isStreaming)

  return (
    <Collapsible
      className="jingle-reasoning-message"
      data-active={isStreaming ? "true" : "false"}
      onOpenChange={setOpenOverride}
      open={isOpen}
    >
      <CollapsibleTrigger
        className={cn(
          "jingle-reasoning-trigger group w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          hasText ? "cursor-pointer" : "cursor-default"
        )}
        disabled={!hasText}
      >
        <ActiveTurnStatusRow
          active={isStreaming}
          coachTip={coachTip}
          icon={<MessageCircle className="size-[var(--jingle-icon-sm)]" />}
          label={title}
          labelClassName="jingle-reasoning-title truncate"
          role={isStreaming ? "status" : undefined}
          status="thinking"
          trailing={
            <ChevronRight
              className={cn(
                "jingle-reasoning-chevron size-[var(--jingle-icon-sm)] shrink-0 text-[var(--jingle-agent-timeline-muted)]",
                !hasText && "opacity-0"
              )}
            />
          }
          trailingPlacement="inline"
        />
      </CollapsibleTrigger>
      {hasText ? (
        <CollapsibleContent className="jingle-reasoning-content jingle-agent-tool-content overflow-hidden">
          <div className="mt-[var(--jingle-space-1)] min-w-0 max-w-full pl-[calc(var(--jingle-icon-action)+var(--jingle-gap-sm))] whitespace-pre-wrap [overflow-wrap:anywhere] [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)]">
            {text}
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  )
}

function ThinkingMessage(props: {
  coachTip?: JingleRunCoachTipProjection | null
  isStreaming?: boolean
  text: string
}): React.JSX.Element | null {
  const { coachTip, isStreaming, text } = props

  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent className="w-full gap-[var(--jingle-space-2-5)]">
        <ReasoningBlock coachTip={coachTip} isStreaming={isStreaming} text={text} />
      </MessageContent>
    </Message>
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

  const attachmentBlocks = content.reduce<
    Array<{ block: (typeof content)[number]; index: number }>
  >((blocks, block, index) => {
    if (block.type === "image" || block.type === "image_url" || block.type === "file") {
      blocks.push({ block, index })
    }

    return blocks
  }, [])
  const reasoningText =
    isUser || !includeReasoning
      ? ""
      : content.reduce((text, block) => {
          return block.type === "reasoning" ? text + getReasoningBlockText(block) : text
        }, "")

  const lastTextBlockIndex = [...content]
    .reverse()
    .findIndex(
      (block) =>
        block.type !== "reasoning" &&
        block.type !== "image" &&
        block.type !== "image_url" &&
        block.type !== "file" &&
        getContentBlockDisplayText(block).trim().length > 0
    )
  const resolvedLastTextBlockIndex =
    lastTextBlockIndex === -1 ? -1 : content.length - lastTextBlockIndex - 1

  const textBlocks = content.flatMap((block, index) => {
    if (block.type === "image" || block.type === "image_url" || block.type === "file") {
      return []
    }

    if (block.type === "reasoning") {
      return []
    }

    const text = getContentBlockDisplayText(block)
    return [
      renderTextBlock(text, {
        isStreaming: isStreaming && index === resolvedLastTextBlockIndex,
        isUser,
        key: `${block.type}-${index}`,
        onOpenWorkspaceFile
      })
    ]
  })

  return {
    attachments: <MessageAttachments blocks={attachmentBlocks} isUser={isUser} />,
    reasoningContent: reasoningText.trim() ? (
      <ReasoningBlock isStreaming={isStreaming} text={reasoningText} />
    ) : null,
    textContent: textBlocks.length > 0 ? textBlocks : null
  }
}

type ToolActivityView = {
  activeToolCall?: JingleActiveAgentToolCall
  approvalRequest: HITLRequest | null
  execution: AgentToolExecutionView | undefined
  item: Extract<AgentActivityItem, { kind: "tool" }>
  key: string
  kind: "tool"
  result: ToolResultInfo | undefined
  status: AgentToolExecutionViewStatus
  view: ReturnType<typeof createActionMessageView>
}

type ActivityView = ToolActivityView

function getAgentActivitySummaryIcon(kind: AgentActivitySummaryIcon): React.JSX.Element {
  switch (kind) {
    case "command":
      return <Terminal className="size-[var(--jingle-icon-action)]" />
    case "file":
      return <FileText className="size-[var(--jingle-icon-action)]" />
    case "folder":
      return <FolderOpen className="size-[var(--jingle-icon-action)]" />
    case "pencil":
      return <Edit className="size-[var(--jingle-icon-action)]" />
    case "search":
      return <Search className="size-[var(--jingle-icon-action)]" />
  }
}

function isFileMutationToolName(name: string): boolean {
  return name === "edit_file" || name === "write_file"
}

function hasUnappliedFileMutationAction(action: ToolActivityView): boolean {
  if (!isFileMutationToolName(action.item.toolCall.name)) {
    return false
  }

  if (!action.result) {
    return true
  }

  return action.result.fileMutation === null
}

function toAgentActivitySummaryTool(action: ToolActivityView) {
  return {
    status: action.status,
    toolCall: action.item.toolCall
  }
}

function isActivityViewPending(action: ActivityView): boolean {
  return (
    action.status === "approval" ||
    action.status === "arguments_streaming" ||
    action.status === "running" ||
    action.status === "waiting_result"
  )
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
}): AgentToolExecutionViewStatus {
  if (input.approvalRequest) {
    return "approval"
  }

  return input.execution?.status ?? "complete"
}

function projectToolActivityView(input: {
  copy: ReturnType<typeof useI18n>["copy"]
  item: Extract<AgentActivityItem, { kind: "tool" }>
  pendingApproval: HITLRequest | null | undefined
  threadId: string
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
    fileMutationResult: result?.fileMutation,
    presentation: "grouped",
    result: result?.content,
    status,
    threadId: input.threadId,
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
  coachTip?: JingleRunCoachTipProjection | null
  defaultOpen?: boolean
  items: AgentActivityItem[]
  onOpenChange?: (open: boolean) => void
  open?: boolean
  pendingApproval?: HITLRequest | null
  threadId: string
  toolExecutions: AgentToolExecutionsView
  toolResults: Map<string, ToolResultInfo>
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const {
    activeThinking = false,
    coachTip = null,
    defaultOpen = false,
    items,
    onOpenChange,
    open,
    pendingApproval,
    threadId,
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
            threadId,
            toolExecutions,
            toolResults
          })
      ),
    [copy, items, pendingApproval, threadId, toolExecutions, toolResults]
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
  const canUseHeaderSummary = !actionViews.some(hasUnappliedFileMutationAction)
  const headerSummary = canUseHeaderSummary
    ? projectAgentActivityHeaderSummary(copy, actionViews.map(toAgentActivitySummaryTool))
    : null
  const fallbackHeaderText = projectAgentActivityFallbackHeaderText(copy, {
    hasApprovalActions,
    hasLoadingActions,
    itemsLength: items.length
  })
  const headerTitle = hasApprovalActions
    ? copy.chat.agentStatusWaitingApproval
    : activeThinking
      ? copy.chat.agentStatusThinking
      : (headerSummary?.title ?? fallbackHeaderText.title)
  const headerDetail = hasApprovalActions
    ? null
    : activeThinking
      ? null
      : (headerSummary?.detail ?? fallbackHeaderText.detail)
  const headerTextActive = !hasApprovalActions && (activeThinking || hasLoadingActions)
  const headerIcon = headerSummary ? getAgentActivitySummaryIcon(headerSummary.icon) : undefined

  return (
    <AgentToolGroup
      active={!hasApprovalActions && (activeThinking || hasLoadingActions)}
      onOpenChange={onOpenChange ?? setOpenOverride}
      open={isOpen}
    >
      <AgentToolGroupTrigger
        active={headerTextActive}
        className="leading-[var(--jingle-line-chat)]"
        detail={activeThinking ? <RunCoachTip tip={coachTip} /> : headerDetail}
        icon={headerIcon}
        {...(headerToolAction
          ? { "data-tool-call-toggle": headerToolAction.item.toolCall.name }
          : {})}
      >
        {headerTitle}
      </AgentToolGroupTrigger>
      <AgentToolGroupContent className="jingle-agent-activity-group-content space-y-[var(--jingle-space-2)]">
        {actionViews.map((action) => {
          return (
            <div className="jingle-agent-activity-tool-item" key={action.key}>
              <ActionMessage
                activeToolCall={action.activeToolCall}
                approvalRequest={action.approvalRequest}
                durationMs={action.execution?.execution?.durationMs}
                fileMutationResult={action.result?.fileMutation}
                presentation="grouped"
                result={action.result?.content}
                status={action.status}
                threadId={threadId}
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
  coachTip?: JingleRunCoachTipProjection | null
  items: AgentActivityItem[]
  pendingApproval?: HITLRequest | null
  threadId: string
  toolExecutions: AgentToolExecutionsView
  toolResults: Map<string, ToolResultInfo>
}): React.JSX.Element | null {
  const {
    activeThinking = false,
    coachTip = null,
    items,
    pendingApproval,
    threadId,
    toolExecutions,
    toolResults
  } = props
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
        threadId,
        toolExecutions,
        toolResults
      })
      const headerSummary = hasUnappliedFileMutationAction(toolActivity)
        ? null
        : projectAgentActivityHeaderSummary(copy, [toAgentActivitySummaryTool(toolActivity)])

      if (activeThinking || isActivityViewPending(toolActivity) || headerSummary) {
        return (
          <Message className="max-w-full" from="assistant">
            <MessageContent className="w-full gap-[var(--jingle-gap-md)]">
              <AgentActivityGroup
                activeThinking={activeThinking}
                coachTip={coachTip}
                defaultOpen={false}
                items={items}
                onOpenChange={handleExpandedChange}
                open={isExpanded}
                pendingApproval={pendingApproval}
                threadId={threadId}
                toolExecutions={toolExecutions}
                toolResults={toolResults}
              />
            </MessageContent>
          </Message>
        )
      }

      return (
        <Message className="max-w-full" from="assistant">
          <MessageContent className="w-full gap-[var(--jingle-space-2-5)]">
            <ActionMessage
              activeToolCall={toolActivity.activeToolCall}
              approvalRequest={toolActivity.approvalRequest}
              durationMs={toolActivity.execution?.execution?.durationMs}
              expanded={isExpanded}
              fileMutationResult={toolActivity.result?.fileMutation}
              onExpandedChange={handleExpandedChange}
              result={toolActivity.result?.content}
              status={toolActivity.status}
              threadId={threadId}
              toolCall={toolActivity.item.toolCall}
            />
          </MessageContent>
        </Message>
      )
    }
  }

  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent className="w-full gap-[var(--jingle-gap-md)]">
        <AgentActivityGroup
          activeThinking={activeThinking}
          coachTip={coachTip}
          defaultOpen={false}
          items={items}
          onOpenChange={handleExpandedChange}
          open={isExpanded}
          pendingApproval={pendingApproval}
          threadId={threadId}
          toolExecutions={toolExecutions}
          toolResults={toolResults}
        />
      </MessageContent>
    </Message>
  )
}

function isAssistantAnswerEntry(entry: TurnAssistantEntry): boolean {
  return entry.kind === "assistant-content"
}

function createAssistantProcessEntry(
  entry: TurnAssistantEntry,
  index: number
): AssistantProcessRenderEntry {
  if (entry.kind === "thinking") {
    return { entry, index, kind: entry.kind }
  }

  if (entry.kind === "assistant-content") {
    return { entry, index, kind: entry.kind }
  }

  return { entry, index, kind: entry.kind }
}

function createAssistantProcessEntries(
  entries: readonly TurnAssistantEntry[],
  startIndex = 0
): AssistantProcessRenderEntry[] {
  return entries.map((entry, index) => createAssistantProcessEntry(entry, startIndex + index))
}

function splitAssistantProcessEntries(entries: readonly TurnAssistantEntry[]): {
  finalEntries: AssistantProcessRenderEntry[]
  processEntries: AssistantProcessRenderEntry[]
} {
  let splitIndex = entries.length
  while (splitIndex > 0 && isAssistantAnswerEntry(entries[splitIndex - 1]!)) {
    splitIndex -= 1
  }

  return {
    finalEntries: createAssistantProcessEntries(entries.slice(splitIndex), splitIndex),
    processEntries: createAssistantProcessEntries(entries.slice(0, splitIndex))
  }
}

function getAgentActivityEntries(
  entries: readonly AssistantProcessRenderEntry[]
): Array<Extract<AssistantProcessRenderEntry, { kind: "agent-activity" }>> {
  return entries.filter(
    (entry): entry is Extract<AssistantProcessRenderEntry, { kind: "agent-activity" }> =>
      entry.kind === "agent-activity"
  )
}

function renderAssistantProcessEntry(input: {
  activeTurnStatus: ActiveTurnStatusProjection | null
  entry: AssistantProcessRenderEntry
  isStreaming: boolean
  latestEntryIndex: number
  pendingApproval?: HITLRequest | null
  streamingAssistantId: string | null
  threadId: string
  toolExecutions: AgentToolExecutionsView
  toolResults: Map<string, ToolResultInfo>
}): React.ReactNode {
  const {
    activeTurnStatus,
    entry,
    isStreaming,
    latestEntryIndex,
    pendingApproval,
    streamingAssistantId,
    threadId,
    toolExecutions,
    toolResults
  } = input

  if (entry.kind === "thinking") {
    return (
      <ThinkingMessage
        coachTip={entry.entry.coachTip}
        isStreaming={isStreaming && entry.entry.isActive}
        key={entry.entry.key}
        text={entry.entry.text}
      />
    )
  }

  if (entry.kind === "assistant-content") {
    return (
      <AssistantBlock
        isLastAssistant={entry.entry.message.id === streamingAssistantId}
        isLoading={isStreaming}
        key={entry.entry.key}
        message={entry.entry.message}
        threadId={threadId}
      />
    )
  }

  return (
    <AssistantActivityCluster
      activeThinking={isStreaming && entry.index === latestEntryIndex}
      coachTip={
        entry.index === latestEntryIndex &&
        activeTurnStatus?.placement === "inside_latest_agent_activity"
          ? activeTurnStatus.coachTip
          : null
      }
      items={entry.entry.items}
      key={entry.entry.key}
      pendingApproval={pendingApproval}
      threadId={threadId}
      toolExecutions={toolExecutions}
      toolResults={toolResults}
    />
  )
}

function AssistantProcessFold(props: {
  children: React.ReactNode
  entries: readonly AssistantProcessRenderEntry[]
  pendingApproval?: HITLRequest | null
  threadId: string
  turnElapsed: TurnElapsedProjection | null
  toolExecutions: AgentToolExecutionsView
  toolResults: Map<string, ToolResultInfo>
}): React.JSX.Element {
  const { children, entries, pendingApproval, threadId, turnElapsed, toolExecutions, toolResults } =
    props
  const { copy } = useI18n()
  const title = getAssistantProcessFoldTitle({ copy, turnElapsed })
  const summaryParts = useMemo(
    () =>
      projectAssistantProcessFoldSummary({
        copy,
        entries,
        pendingApproval,
        threadId,
        toolExecutions,
        toolResults
      }),
    [copy, entries, pendingApproval, threadId, toolExecutions, toolResults]
  )

  return (
    <AgentToolGroup className="jingle-assistant-process-fold" defaultOpen={false}>
      <AgentToolGroupTrigger
        className="leading-[var(--jingle-line-chat)]"
        detail={summaryParts.details.join(" · ")}
        icon={null}
        leadingAccessory={
          <span
            aria-label={copy.chat.turnProcessSteps(summaryParts.stepCount)}
            className="inline-flex h-[18px] shrink-0 items-center rounded-[var(--jingle-radius-sm)] border border-border/60 bg-background-secondary/42 px-[var(--jingle-space-1-5)] text-[10px] font-medium tabular-nums"
          >
            {summaryParts.stepCount}
          </span>
        }
        showLeadingToggle
      >
        {title}
      </AgentToolGroupTrigger>
      <AgentToolGroupContent className="jingle-agent-activity-group-content">
        {children}
      </AgentToolGroupContent>
    </AgentToolGroup>
  )
}

function projectAssistantProcessFoldSummary(input: {
  copy: ReturnType<typeof useI18n>["copy"]
  entries: readonly AssistantProcessRenderEntry[]
  pendingApproval?: HITLRequest | null
  threadId: string
  toolExecutions: AgentToolExecutionsView
  toolResults: Map<string, ToolResultInfo>
}): {
  details: string[]
  stepCount: number
} {
  const { copy, entries, pendingApproval, threadId, toolExecutions, toolResults } = input
  const agentActivityEntries = getAgentActivityEntries(entries)
  const actionViews = agentActivityEntries.flatMap((entry) =>
    entry.entry.items.map((item) =>
      projectToolActivityView({
        copy,
        item,
        pendingApproval,
        threadId,
        toolExecutions,
        toolResults
      })
    )
  )
  const stepCount = actionViews.length
  const canUseHeaderSummary = !actionViews.some(hasUnappliedFileMutationAction)
  const activitySummary =
    canUseHeaderSummary && actionViews.length > 0
      ? projectAgentActivityHeaderSummary(copy, actionViews.map(toAgentActivitySummaryTool))
      : null
  const details = activitySummary?.detail ? [activitySummary.detail] : []

  return {
    details,
    stepCount
  }
}

function getAssistantProcessFoldTitle(input: {
  copy: ReturnType<typeof useI18n>["copy"]
  turnElapsed: TurnElapsedProjection | null
}): string {
  const { copy, turnElapsed } = input
  if (turnElapsed === null || turnElapsed.status !== "worked") {
    return copy.chat.turnProcessed
  }

  return copy.chat.turnWorkedFor(formatTurnElapsedTime(turnElapsed.durationMs))
}

function AssistantBlock(props: {
  isLastAssistant: boolean
  isLoading?: boolean
  message: ThreadMessage
  threadId: string
}): React.JSX.Element | null {
  const { isLastAssistant, isLoading, message, threadId } = props
  const isStreaming = Boolean(isLoading) && isLastAssistant
  const content = renderStructuredContent(message.content, {
    includeReasoning: false,
    isStreaming,
    isUser: false
  })

  if (!content.attachments && !content.reasoningContent && !content.textContent) {
    return null
  }

  return (
    <Message className="max-w-full" data-assistant-message-id={message.id} from="assistant">
      <MessageContent className="w-full gap-[var(--jingle-gap-md)]">
        {content.attachments}
        {content.reasoningContent}
        {content.textContent ? (
          <AssistantContentCards isStreaming={isStreaming} message={message} threadId={threadId} />
        ) : null}
      </MessageContent>
    </Message>
  )
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
    <div className="flex items-center gap-[var(--jingle-gap-sm)] py-[var(--jingle-space-1)] text-[var(--jingle-agent-timeline-muted)] [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)]">
      <span className="shrink-0 tabular-nums">{label}</span>
      <span className="h-px min-w-0 flex-1 bg-border/70" />
    </div>
  )
}

function RunCoachTip(props: { tip: JingleRunCoachTipProjection | null }): React.JSX.Element | null {
  const { copy } = useI18n()
  const { tip } = props

  if (!tip) {
    return null
  }

  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center truncate text-[var(--jingle-agent-timeline-muted)]"
      data-run-coach-tip={tip.id}
    >
      <span className="min-w-0 truncate">{copy.chat.runCoachTip[tip.id]}</span>
    </span>
  )
}

function ActiveTurnStatusRow(props: {
  active?: boolean
  coachTip?: JingleRunCoachTipProjection | null
  icon: React.ReactNode
  label: React.ReactNode
  labelClassName?: string
  role?: React.AriaRole
  status: JingleActiveRunCoachStatusKind
  trailing?: React.ReactNode
  trailingPlacement?: "edge" | "inline"
}): React.JSX.Element {
  const {
    active = false,
    coachTip = null,
    icon,
    label,
    labelClassName,
    role,
    status,
    trailing,
    trailingPlacement
  } = props

  return (
    <AgentActivityRow
      active={active}
      className="w-full text-[var(--jingle-agent-timeline-muted)]"
      data-active-turn-status={status}
      detail={<RunCoachTip tip={coachTip} />}
      detailClassName="max-w-[min(36rem,52vw)]"
      icon={icon}
      label={label}
      labelClassName={labelClassName}
      role={role}
      trailing={trailing}
      trailingPlacement={trailingPlacement}
    />
  )
}

function WaitingApprovalStatusRow(): React.JSX.Element {
  const { copy } = useI18n()

  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent className="w-full gap-[var(--jingle-space-2-5)]">
        <ActiveTurnStatusRow
          icon={<TriangleAlert className="size-[var(--jingle-icon-action)] text-status-warning" />}
          label={copy.chat.agentStatusWaitingApproval}
          role="status"
          status="waiting_approval"
        />
      </MessageContent>
    </Message>
  )
}

function SteeredConversationStatusRow(): React.JSX.Element {
  const { copy } = useI18n()

  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent className="w-full gap-[var(--jingle-space-2-5)]">
        <AgentActivityRow
          className="w-full text-[var(--jingle-agent-timeline-muted)]"
          data-steered-conversation-status="applied"
          label={copy.chat.agentStatusSteered}
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
          className="ml-auto flex w-full max-w-full flex-col gap-[var(--jingle-space-3)] rounded-[var(--jingle-radius-md)] bg-secondary px-[var(--jingle-message-bubble-x)] py-[var(--jingle-message-bubble-y)] text-foreground"
          onSubmit={(event) => {
            event.preventDefault()
            void submitEdit()
          }}
        >
          <textarea
            aria-label={copy.chat.editUserMessage}
            autoFocus
            className="min-h-[7rem] w-full resize-y bg-transparent [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)] text-foreground outline-none placeholder:text-muted-foreground"
            disabled={isSubmittingEdit}
            onChange={(event) => {
              const text = event.currentTarget.value
              setEditingInput((current) => (current ? { ...current, text } : current))
            }}
            value={editingInput.text}
          />
          <div className="flex items-center justify-end gap-[var(--jingle-gap-sm)]">
            <button
              className="inline-flex h-[var(--jingle-control-h-md)] items-center justify-center rounded-[var(--jingle-radius-sm)] bg-background-elevated px-[var(--jingle-space-3)] [font-size:var(--jingle-font-meta)] text-muted-foreground transition hover:bg-background-interactive hover:text-foreground disabled:opacity-50"
              disabled={isSubmittingEdit}
              onClick={cancelEditing}
              type="button"
            >
              {copy.chat.cancelEditMessage}
            </button>
            <button
              className="inline-flex h-[var(--jingle-control-h-md)] items-center justify-center rounded-[var(--jingle-radius-sm)] bg-primary px-[var(--jingle-space-3)] [font-size:var(--jingle-font-meta)] text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
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
        <MessageContent className="gap-[var(--jingle-space-2-5)]">
          {content.textContent}
        </MessageContent>
      ) : null}
      {hasActions ? (
        <MessageToolbar className="-mt-[var(--jingle-space-1)] ml-auto justify-end">
          <MessageActions className="h-[var(--jingle-control-h-compact)] rounded-[var(--jingle-radius-sm)] border border-transparent px-[var(--jingle-space-1)] text-muted-foreground">
            <span className="px-[var(--jingle-space-1)] [font-size:var(--jingle-font-meta)] tabular-nums">
              {createdAtLabel}
            </span>
            {canCopy ? (
              <MessageAction asChild label={copy.chat.copyMessage} tooltip={copy.chat.copyMessage}>
                <CopyButton
                  className="size-[22px] rounded-[var(--jingle-radius-sm)] text-muted-foreground hover:text-foreground [&_svg]:size-[var(--jingle-icon-sm)]"
                  copiedLabel={copy.common.copied}
                  copyLabel={copy.chat.copyMessage}
                  iconClassName="size-[var(--jingle-icon-sm)]"
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
                <Edit className="size-[var(--jingle-icon-sm)]" />
              </MessageAction>
            ) : null}
          </MessageActions>
        </MessageToolbar>
      ) : null}
    </Message>
  )
}

export const MessageTurnView = memo(function MessageTurnView(props: {
  activeToolCalls: readonly JingleActiveAgentToolCall[]
  activeRunPhase?: JingleAgentRunPhase | null
  activeRunStartedAt?: Date | null
  isActiveTurn: boolean
  isLatestTurn: boolean
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
    activeRunPhase,
    activeRunStartedAt,
    isActiveTurn,
    isLatestTurn,
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
  const activeTurnStatusRow =
    activeTurnStatus?.kind === "thinking" ? (
      <ThinkingMessage
        coachTip={activeTurnStatus.coachTip}
        isStreaming
        key={`thinking:${streamingAssistantId ?? "active"}`}
        text=""
      />
    ) : activeTurnStatus?.kind === "waiting_approval" ? (
      <WaitingApprovalStatusRow
        key={`${activeTurnStatus.kind}:${activeTurnStatus.toolCallId ?? "turn"}`}
      />
    ) : null
  const steeredConversationStatusRow =
    readJingleSteeringStatus(turn.user?.metadata) === "applied" ? (
      <SteeredConversationStatusRow />
    ) : null
  const { finalEntries, processEntries } = useMemo(
    () => splitAssistantProcessEntries(assistantEntries),
    [assistantEntries]
  )
  const latestEntryIndex = assistantEntries.length - 1
  const shouldFoldProcess =
    !isLatestTurn && !isStreaming && processEntries.some((item) => item.kind === "agent-activity")
  const visibleEntries = shouldFoldProcess
    ? finalEntries
    : assistantEntries.map(createAssistantProcessEntry)
  const processFold =
    shouldFoldProcess && processEntries.length > 0 ? (
      <AssistantProcessFold
        entries={processEntries}
        key="assistant-process-fold"
        pendingApproval={pendingApproval}
        threadId={threadId}
        turnElapsed={turnElapsed}
        toolExecutions={toolExecutions}
        toolResults={toolResults}
      >
        {processEntries.map((item) =>
          renderAssistantProcessEntry({
            activeTurnStatus,
            entry: item,
            isStreaming,
            latestEntryIndex,
            pendingApproval,
            streamingAssistantId,
            threadId,
            toolExecutions,
            toolResults
          })
        )}
      </AssistantProcessFold>
    ) : null
  return (
    <div
      className="space-y-[var(--jingle-space-2-5)]"
      data-message-turn-active={isActiveTurn ? "true" : "false"}
      data-message-turn-folded={shouldFoldProcess ? "true" : "false"}
      data-message-turn-key={turn.key}
      data-message-turn-streaming={isStreaming ? "true" : "false"}
    >
      {turn.user ? (
        <UserMessage
          editInput={onEditLastUserMessage ? retryInput : null}
          key={`${turn.user.id}:${onEditLastUserMessage ? "editable" : "read-only"}`}
          message={turn.user}
          onSubmitEdit={onEditLastUserMessage ? handleSubmitUserEdit : undefined}
          threadId={threadId}
        />
      ) : null}
      {steeredConversationStatusRow}
      {turnElapsed && !processFold ? <TurnElapsedDivider projection={turnElapsed} /> : null}
      {activeTurnStatus?.placement === "before_entries" ? activeTurnStatusRow : null}
      {processFold}
      {visibleEntries.map((entry) =>
        renderAssistantProcessEntry({
          activeTurnStatus,
          entry,
          isStreaming,
          latestEntryIndex,
          pendingApproval,
          streamingAssistantId,
          threadId,
          toolExecutions,
          toolResults
        })
      )}
      {activeTurnStatus?.placement === "after_entries" ? activeTurnStatusRow : null}

      <ContextEvidencePanel threadId={threadId} turnId={turn.key} />

      {hasAssistantMessages && !shouldHideToolbar ? (
        <MessageToolbar className="mt-0 justify-start">
          <MessageActions>
            {isActiveTurn && onRetry && retryInput && !isStreaming ? (
              <MessageAction
                label={copy.chat.retryMessage}
                onClick={() => void onRetry(retryInput)}
                tooltip={copy.chat.retryMessage}
              >
                <RefreshCcwIcon className="size-[var(--jingle-icon-action)]" />
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
                <GitForkIcon className="size-[var(--jingle-icon-sm)]" />
              </MessageAction>
            ) : null}
            {copyText ? (
              <MessageAction asChild label={copy.chat.copyMessage} tooltip={copy.chat.copyMessage}>
                <CopyButton
                  className="size-[22px] rounded-[var(--jingle-radius-sm)] text-muted-foreground hover:text-foreground [&_svg]:size-[var(--jingle-icon-sm)]"
                  copiedLabel={copy.common.copied}
                  copyLabel={copy.chat.copyMessage}
                  iconClassName="size-[var(--jingle-icon-action)]"
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
