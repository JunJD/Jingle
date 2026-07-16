import { ChevronRight, FileText, MessageCircle } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import type { Message as ThreadMessage } from "@/types"
import type {
  JingleActiveRunCoachStatusKind,
  JingleRunCoachTipProjection
} from "@jingle/agent-react"
import { AgentActivityRow } from "@/components/agent-ui"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { InlineNotice } from "@/components/ui/inline-notice"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import {
  projectMessageAttachmentPresentation,
  projectMessageContent,
  type MessageContentViewBlock
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
import { Message, MessageContent, MessageResponse } from "./message"
import { ExtensionSourceTextViewer } from "./ExtensionSourceTextViewer"
import { AssistantContentCards } from "./AssistantContentCards"

interface StructuredMessageContent {
  attachments: React.ReactNode
  reasoningContent: React.ReactNode
  textContent: React.ReactNode
  unrenderableContent: React.ReactNode
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

function toAttachmentData(
  block: Extract<MessageContentViewBlock, { kind: "attachment" }>,
  clipboardImageLabel: string
): {
  data: AttachmentData
  fallbackIcon?: React.JSX.Element
} {
  const presentation = projectMessageAttachmentPresentation(block, {
    image: clipboardImageLabel
  })

  if (block.attachmentType === "file") {
    return {
      data: presentation,
      fallbackIcon: <FileText className="size-[var(--jingle-icon-display)] text-muted-foreground" />
    }
  }

  return {
    data: presentation
  }
}

function MessageAttachments(props: {
  blocks: Array<Extract<MessageContentViewBlock, { kind: "attachment" }>>
  isUser: boolean
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { blocks, isUser } = props
  const attachments = blocks.map((block) => toAttachmentData(block, copy.launcher.clipboardImage))

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
        <Button
          type="button"
          aria-expanded={isExpanded}
          className="mt-[var(--jingle-space-1)] h-auto cursor-pointer gap-[var(--jingle-gap-xs)] self-start p-0 text-muted-foreground hover:bg-transparent hover:text-foreground [font-size:var(--jingle-font-body)]"
          onClick={toggleExpansion}
          variant="ghost"
        >
          <span>{isExpanded ? copy.chat.userMessageShowLess : copy.chat.userMessageShowMore}</span>
          <ChevronRight
            className={cn("size-[var(--jingle-icon-xs)]", isExpanded ? "-rotate-90" : "rotate-90")}
          />
        </Button>
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

function UnrenderableContentNotice(props: {
  blocks: Array<Extract<MessageContentViewBlock, { kind: "unrenderable" }>>
}): React.JSX.Element | null {
  const { copy } = useI18n()
  const { blocks } = props
  if (blocks.length === 0) {
    return null
  }

  return (
    <InlineNotice
      data-message-content-errors={blocks.length}
      data-message-content-source-types={blocks
        .map((block) => block.sourceType ?? "unknown")
        .join(",")}
      tone="warning"
    >
      {copy.chat.messageContentUnavailable}
    </InlineNotice>
  )
}

export function RunCoachTip(props: {
  tip: JingleRunCoachTipProjection | null
}): React.JSX.Element | null {
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

export function ActiveTurnStatusRow(props: {
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

export function ThinkingMessage(props: {
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

export function renderStructuredContent(
  content: ThreadMessage["content"],
  options: {
    includeReasoning?: boolean
    isStreaming?: boolean
    isUser: boolean
    onOpenWorkspaceFile?: (path: string) => void
  }
): StructuredMessageContent {
  const { includeReasoning = true, isStreaming, isUser, onOpenWorkspaceFile } = options
  const projection = projectMessageContent(content)
  const attachmentBlocks = projection.blocks.filter(
    (block): block is Extract<MessageContentViewBlock, { kind: "attachment" }> =>
      block.kind === "attachment"
  )
  const unrenderableBlocks = projection.blocks.filter(
    (block): block is Extract<MessageContentViewBlock, { kind: "unrenderable" }> =>
      block.kind === "unrenderable"
  )
  const textBlocks = projection.blocks.filter(
    (block): block is Extract<MessageContentViewBlock, { kind: "text" }> => block.kind === "text"
  )
  const lastTextSourceIndex = textBlocks.findLast(
    (block) => block.text.trim().length > 0
  )?.sourceIndex
  const renderedTextBlocks = textBlocks.map((block) =>
    renderTextBlock(block.text, {
      isStreaming: isStreaming && block.sourceIndex === lastTextSourceIndex,
      isUser,
      key: `text-${block.sourceIndex}`,
      onOpenWorkspaceFile
    })
  )
  const reasoningText = isUser || !includeReasoning ? "" : projection.reasoningText

  return {
    attachments: <MessageAttachments blocks={attachmentBlocks} isUser={isUser} />,
    reasoningContent: reasoningText.trim() ? (
      <ReasoningBlock isStreaming={isStreaming} text={reasoningText} />
    ) : null,
    textContent: renderedTextBlocks.length > 0 ? renderedTextBlocks : null,
    unrenderableContent:
      unrenderableBlocks.length > 0 ? (
        <UnrenderableContentNotice blocks={unrenderableBlocks} />
      ) : null
  }
}

export function AssistantBlock(props: {
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

  if (
    !content.attachments &&
    !content.reasoningContent &&
    !content.textContent &&
    !content.unrenderableContent
  ) {
    return null
  }

  return (
    <Message
      className="max-w-full"
      data-assistant-message-id={message.id}
      data-assistant-selection-source="true"
      data-assistant-message-streaming={isStreaming ? "true" : "false"}
      from="assistant"
    >
      <MessageContent className="w-full gap-[var(--jingle-gap-md)]">
        {content.attachments}
        {content.reasoningContent}
        {content.unrenderableContent}
        {content.textContent ? (
          <AssistantContentCards isStreaming={isStreaming} message={message} threadId={threadId} />
        ) : null}
      </MessageContent>
    </Message>
  )
}
