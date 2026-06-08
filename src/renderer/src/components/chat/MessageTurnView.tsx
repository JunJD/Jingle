import { ChevronRight, FileText, GitForkIcon, RefreshCcwIcon } from "lucide-react"
import { memo, useCallback, useMemo, useState } from "react"
import {
  extractComposerMessageRefsMetadata,
  hasMessageContent,
  resolveImageBlockUrl,
  toComposerMessageInput,
  type ComposerMessageInput
} from "@shared/message-content"
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
  getTurnCopyText,
  getTurnToolDisplayPolicy,
  type AgentActivityItem,
  type MessageTurn,
  type ToolResultInfo
} from "@/lib/message-projection"
import type { AgentToolExecutionView, AgentToolExecutionsView } from "@/lib/message-projection"
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
import { AssistantSelectionReferencesFromMetadata } from "./AssistantSelectionReferences"
import { getAssistantSelectionRefs } from "./useAssistantSelectionRefs"
import { useThreadControl } from "@/lib/thread-context"

interface StructuredMessageContent {
  attachments: React.ReactNode
  reasoningContent: React.ReactNode
  textContent: React.ReactNode
}

function getWorkspaceFileName(path: string): string {
  return path.split("/").pop() || path
}

function ThinkingIcon(props: React.SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M3.5 19A1.5 1.5 0 0 1 5 20.5A1.5 1.5 0 0 1 3.5 22A1.5 1.5 0 0 1 2 20.5A1.5 1.5 0 0 1 3.5 19m5-3a2.5 2.5 0 0 1 2.5 2.5A2.5 2.5 0 0 1 8.5 21A2.5 2.5 0 0 1 6 18.5A2.5 2.5 0 0 1 8.5 16m6-1c-1.19 0-2.27-.5-3-1.35c-.73.85-1.81 1.35-3 1.35c-1.96 0-3.59-1.41-3.93-3.26A4.02 4.02 0 0 1 2 8a4 4 0 0 1 4-4c.26 0 .5.03.77.07C7.5 3.41 8.45 3 9.5 3c1.19 0 2.27.5 3 1.35c.73-.85 1.81-1.35 3-1.35c1.96 0 3.59 1.41 3.93 3.26A4.02 4.02 0 0 1 22 10a4 4 0 0 1-4 4l-.77-.07c-.73.66-1.68 1.07-2.73 1.07" />
    </svg>
  )
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
    return (
      <div
        key={key}
        className="whitespace-pre-wrap [overflow-wrap:anywhere] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
      >
        <ExtensionSourceTextViewer onOpenWorkspaceFile={onOpenWorkspaceFile} text={text} />
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
  approvalRequest: HITLRequest | null
  execution: AgentToolExecutionView | undefined
  item: Extract<AgentActivityItem, { kind: "tool" }>
  key: string
  kind: "tool"
  result: ToolResultInfo | undefined
  status: ProjectedToolActivityStatus
  view: ReturnType<typeof createActionMessageView>
}

type ActivityView = ThinkingActivityView | ToolActivityView
type ProjectedToolActivityStatus = "approval" | "complete" | "running"

function isActivityViewPending(action: ActivityView): boolean {
  return action.kind === "thinking" ? action.streaming : action.status !== "complete"
}

function isActivityViewLoading(action: ActivityView): boolean {
  return action.kind === "thinking" ? action.streaming : action.status === "running"
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
  defaultOpen?: boolean
  isStreaming: boolean
  items: AgentActivityItem[]
  preferLatestToolSummary?: boolean
  onOpenChange?: (open: boolean) => void
  open?: boolean
  pendingApproval?: HITLRequest | null
  streamingAssistantId: string | null
  toolExecutions: AgentToolExecutionsView
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
    toolExecutions,
    toolResults
  } = props
  const [openOverride, setOpenOverride] = useState<boolean | null>(null)

  const actionViews: ActivityView[] = useMemo(
    () =>
      items.map((item): ActivityView => {
        if (item.kind === "thinking") {
          return {
            item,
            key: item.key,
            kind: "thinking",
            streaming: isThinkingItemStreaming(item, { isStreaming, streamingAssistantId })
          }
        }

        return projectToolActivityView({
          copy,
          item,
          pendingApproval,
          toolExecutions,
          toolResults
        })
      }),
    [copy, isStreaming, items, pendingApproval, streamingAssistantId, toolExecutions, toolResults]
  )

  if (items.length === 0) {
    return null
  }
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
                approvalRequest={action.approvalRequest}
                presentation="grouped"
                result={action.result?.content}
                status={action.status}
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
  isStreaming: boolean
  items: AgentActivityItem[]
  preferLatestToolSummary?: boolean
  pendingApproval?: HITLRequest | null
  streamingAssistantId: string | null
  toolExecutions: AgentToolExecutionsView
  toolResults: Map<string, ToolResultInfo>
}): React.JSX.Element | null {
  const {
    isStreaming,
    items,
    pendingApproval,
    preferLatestToolSummary,
    streamingAssistantId,
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
        toolExecutions,
        toolResults
      })

      return (
        <Message className="max-w-full" from="assistant">
          <MessageContent className="w-full gap-[var(--ow-space-2-5)]">
            <ActionMessage
              approvalRequest={toolActivity.approvalRequest}
              expanded={isExpanded}
              onExpandedChange={handleExpandedChange}
              result={toolActivity.result?.content}
              status={toolActivity.status}
              toolCall={toolActivity.item.toolCall}
            />
          </MessageContent>
        </Message>
      )
    }

    return (
      <Message className="max-w-full" from="assistant">
        <MessageContent className="w-full gap-[var(--ow-space-2-5)]">
          <ReasoningBlock
            isStreaming={isThinkingItemStreaming(item, { isStreaming, streamingAssistantId })}
            text={item.text}
          />
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

function AssistantWaitingRow(): React.JSX.Element {
  const { copy } = useI18n()

  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent className="w-full gap-[var(--ow-space-2-5)]">
        <div
          className="flex min-w-0 items-center gap-[var(--ow-gap-sm)] text-[var(--ow-agent-timeline-muted)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)]"
          role="status"
        >
          <LoaderOne className="size-[var(--ow-icon-action)] shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{copy.chat.agentWorking}</span>
        </div>
      </MessageContent>
    </Message>
  )
}

function UserMessage(props: { message: ThreadMessage; threadId: string }): React.JSX.Element | null {
  const { message, threadId } = props
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

  if (!content.attachments && !content.textContent && !hasReferences) {
    return null
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
    </Message>
  )
}

export const MessageTurnView = memo(function MessageTurnView(props: {
  isActiveTurn: boolean
  onBranch?: (messageId: string) => Promise<void> | void
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
    isActiveTurn,
    isStreaming,
    onBranch,
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
  const assistantEntries = useMemo(() => buildTurnAssistantEntries(turn), [turn])
  const shouldShowAssistantWaitingRow = isStreaming && assistantEntries.length === 0
  const toolDisplayPolicy = useMemo(
    () => getTurnToolDisplayPolicy(turn, { isStreaming }),
    [isStreaming, turn]
  )

  return (
    <div className="space-y-[var(--ow-space-2-5)]">
      {turn.user ? <UserMessage message={turn.user} threadId={threadId} /> : null}
      {shouldShowAssistantWaitingRow ? <AssistantWaitingRow /> : null}
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
            isStreaming={isStreaming}
            items={entry.items}
            key={entry.key}
            pendingApproval={pendingApproval}
            preferLatestToolSummary={toolDisplayPolicy.preferLatestSummary}
            streamingAssistantId={streamingAssistantId}
            toolExecutions={toolExecutions}
            toolResults={toolResults}
          />
        )
      })}

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
