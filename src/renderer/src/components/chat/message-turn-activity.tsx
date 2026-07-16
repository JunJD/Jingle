import { Edit, FileText, FolderOpen, Search, Terminal, TriangleAlert } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { HITLRequest } from "@/types"
import type { JingleRunCoachTipProjection } from "@jingle/agent-react"
import type { JingleActiveAgentToolCall } from "@jingle/agent-client"
import { ActionMessage } from "./ActionMessage"
import {
  AgentActivityRow,
  AgentToolGroup,
  AgentToolGroupContent,
  AgentToolGroupTrigger
} from "@/components/agent-ui"
import { createActionMessageView } from "./action-message-view"
import {
  projectAgentActivityHeader,
  projectAgentActivityHeaderSummary,
  type AgentActivitySummaryIcon
} from "./agent-activity-summary"
import { useI18n } from "@/lib/i18n"
import {
  projectToolActivityStatus,
  type ActiveTurnStatusProjection,
  type AgentActivityItem,
  type AgentToolExecutionView,
  type AgentToolExecutionViewStatus,
  type AgentToolExecutionsView,
  type ToolResultInfo,
  type TurnAssistantEntry,
  type TurnElapsedProjection
} from "@/lib/message-projection"
import { Message, MessageContent } from "./message"
import {
  ActiveTurnStatusRow,
  AssistantBlock,
  RunCoachTip,
  ThinkingMessage
} from "./message-turn-content"

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
  const status = projectToolActivityStatus({
    approvalRequired: approvalRequest !== null,
    execution,
    hasDurableResult: result !== undefined
  })
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
  const header = projectAgentActivityHeader(copy, actionViews.map(toAgentActivitySummaryTool), {
    activeThinking,
    canUseSummary: !actionViews.some(hasUnappliedFileMutationAction),
    hasApprovalActions,
    hasLoadingActions,
    itemsLength: items.length
  })
  const headerIcon = header.icon ? getAgentActivitySummaryIcon(header.icon) : undefined

  return (
    <AgentToolGroup
      active={header.active}
      onOpenChange={onOpenChange ?? setOpenOverride}
      open={isOpen}
    >
      <AgentToolGroupTrigger
        active={header.active}
        className="leading-[var(--jingle-line-chat)]"
        detail={activeThinking ? <RunCoachTip tip={coachTip} /> : header.detail}
        icon={headerIcon}
        {...(headerToolAction
          ? { "data-tool-call-toggle": headerToolAction.item.toolCall.name }
          : {})}
      >
        {header.title}
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

export function createAssistantProcessEntry(
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

export function splitAssistantProcessEntries(entries: readonly TurnAssistantEntry[]): {
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

export function renderAssistantProcessEntry(input: {
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

export function AssistantProcessFold(props: {
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

function formatTurnElapsedTime(ms: number): string {
  const totalSeconds = Math.max(1, Math.floor(ms / 1000))
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

export function TurnElapsedDivider(props: {
  projection: TurnElapsedProjection
}): React.JSX.Element {
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

export function WaitingApprovalStatusRow(): React.JSX.Element {
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

export function SteeredConversationStatusRow(): React.JSX.Element {
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
