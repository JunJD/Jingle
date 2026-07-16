import { useEffect, useMemo, useState } from "react"
import type { FileMutationResultMetadata } from "@shared/file-mutation-result"
import type { JingleActiveAgentToolCall } from "@jingle/agent-client"
import { AgentActivityRow, AgentToolStatusBadge, type AgentToolState } from "@/components/agent-ui"
import { useI18n } from "@/lib/i18n"
import type { HITLRequest, ToolCall } from "@/types"
import { createActionMessageView } from "./action-message-view"
import { type ToolPresentation, type ToolComponentStatus } from "./tools"
import { ContentCardFrame } from "./ContentCardFrame"
import { createContentCardId } from "@shared/content-card"
import { projectActionMessageCollapse } from "./action-message-collapse"

interface ActionMessageProps {
  toolCall: ToolCall
  activeToolCall?: JingleActiveAgentToolCall
  fileMutationResult?: FileMutationResultMetadata | null
  result?: unknown
  durationMs?: number | null
  approvalRequest?: HITLRequest | null
  onExpandedChange?: (expanded: boolean) => void
  defaultExpanded?: boolean
  expanded?: boolean
  presentation?: ToolPresentation
  showSummary?: boolean
  status: ToolComponentStatus
  threadId: string
}

function toAgentToolState(status: ToolComponentStatus): AgentToolState {
  switch (status) {
    case "approval":
      return "approval"
    case "complete":
      return "complete"
    case "failed":
    case "unavailable":
      return "error"
    case "arguments_streaming":
    case "running":
    case "waiting_result":
      return "running"
  }
}

function isToolActive(status: ToolComponentStatus): boolean {
  return status === "arguments_streaming" || status === "running" || status === "waiting_result"
}

function getActionMessageStatus(
  status: ToolComponentStatus,
  activeToolCall: JingleActiveAgentToolCall | undefined
): ToolComponentStatus {
  if (activeToolCall?.status === "arguments_streaming") {
    return "arguments_streaming"
  }

  if (activeToolCall?.status === "waiting_result") {
    return "waiting_result"
  }

  return status
}

function formatElapsedTime(ms: number): string {
  if (ms < 1000) {
    return `${Math.max(0, Math.round(ms))}ms`
  }

  const seconds = ms / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }

  const totalSeconds = Math.floor(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

function toolRevision(value: unknown): string {
  const text = JSON.stringify(value) ?? ""
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`
}

function ToolExecutionTime(props: { active: boolean; startedAt?: Date }): React.JSX.Element | null {
  const { active, startedAt } = props
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active || !startedAt) {
      return undefined
    }

    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 200)
    return () => {
      window.clearInterval(timer)
    }
  }, [active, startedAt])

  if (!active || !startedAt) {
    return null
  }

  const startedAtMs = new Date(startedAt).getTime()
  const elapsed = Math.max(0, now - startedAtMs)

  return (
    <span className="shrink-0 text-[var(--jingle-agent-timeline-muted)] [font-size:var(--jingle-font-caption)] tabular-nums">
      {formatElapsedTime(elapsed)}
    </span>
  )
}

function ToolDurationTime(props: { durationMs?: number | null }): React.JSX.Element | null {
  const { durationMs } = props
  if (durationMs === null || durationMs === undefined) {
    return null
  }

  return (
    <span className="shrink-0 text-[var(--jingle-agent-timeline-muted)] [font-size:var(--jingle-font-caption)] tabular-nums">
      {formatElapsedTime(durationMs)}
    </span>
  )
}

export function ActionMessage(props: ActionMessageProps): React.JSX.Element | null {
  const {
    activeToolCall,
    approvalRequest,
    defaultExpanded = false,
    durationMs,
    expanded,
    fileMutationResult,
    onExpandedChange,
    presentation = "standalone",
    result,
    showSummary = true,
    status: explicitStatus,
    threadId,
    toolCall
  } = props
  const { copy } = useI18n()
  const view = useMemo(
    () =>
      createActionMessageView({
        activeArgsText: activeToolCall?.argsText,
        approvalRequest,
        copy,
        fileMutationResult,
        presentation,
        result,
        status: explicitStatus,
        threadId,
        toolCall
      }),
    [
      activeToolCall?.argsText,
      approvalRequest,
      copy,
      explicitStatus,
      fileMutationResult,
      presentation,
      result,
      threadId,
      toolCall
    ]
  )
  const { display, hasDetail, icon: Icon, renderDetail, status, statusLabel } = view
  const activityStatus = getActionMessageStatus(status, activeToolCall)
  const collapse = projectActionMessageCollapse({
    approvalRequired: Boolean(approvalRequest),
    defaultExpanded,
    expanded,
    hasDetail
  })

  const toolState = toAgentToolState(activityStatus)
  const statusMeta =
    statusLabel && toolState !== "complete" ? (
      <AgentToolStatusBadge state={toolState}>{statusLabel}</AgentToolStatusBadge>
    ) : null
  const renderDetailContent = (): React.JSX.Element | null => {
    const detail = renderDetail()
    return detail ? <div className="min-w-0 max-w-full overflow-hidden">{detail}</div> : null
  }
  const executionTime =
    activeToolCall?.status === "running" ? (
      <ToolExecutionTime active startedAt={activeToolCall.startedAt} />
    ) : activityStatus === "complete" || activityStatus === "failed" ? (
      <ToolDurationTime durationMs={durationMs} />
    ) : null
  const resultMeta = display.resultMeta ? (
    <span className="shrink-0 text-[var(--jingle-agent-timeline-muted)] [font-size:var(--jingle-font-caption)]">
      {display.resultMeta}
    </span>
  ) : null
  const meta =
    resultMeta || statusMeta || executionTime ? (
      <>
        {resultMeta}
        {statusMeta}
        {executionTime}
      </>
    ) : null

  if (!showSummary) {
    return renderDetailContent()
  }
  if (fileMutationResult) {
    return renderDetailContent()
  }
  const source = {
    kind: "tool" as const,
    slot: "tool:detail",
    sourceId: toolCall.id,
    sourceType: "tool-call" as const
  }
  const identity = {
    ...source,
    cardId: createContentCardId(source),
    revision: toolRevision({ result, status: activityStatus }),
    threadId
  }
  return (
    <ContentCardFrame
      annotationEnabled={false}
      collapsed={collapse.collapsed}
      collapsible={collapse.interactive}
      defaultCollapsed={collapse.defaultCollapsed}
      identity={identity}
      onCollapsedChange={
        collapse.interactive ? (nextCollapsed) => onExpandedChange?.(!nextCollapsed) : undefined
      }
      selection={{
        anchor: { kind: "whole-card" },
        anchorResolution: isToolActive(activityStatus) ? "pending-stream" : "resolved",
        card: identity,
        contextHash: identity.revision,
        quote: toolCall.display?.title ?? "工具活动"
      }}
      title={display.title}
    >
      {() => (
        <div className="min-w-0" data-tool-call-toggle={toolCall.name}>
          <AgentActivityRow
            active={isToolActive(activityStatus)}
            className="w-full text-[var(--jingle-agent-timeline-muted)]"
            detail={display.detail}
            icon={<Icon className="size-[var(--jingle-icon-sm)]" />}
            label={display.title}
            meta={meta}
            trailingPlacement="inline"
          />
          {hasDetail ? <div className="mt-2 min-w-0">{renderDetailContent()}</div> : null}
        </div>
      )}
    </ContentCardFrame>
  )
}
