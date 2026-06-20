import { ChevronRight } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { ActiveAgentToolCall } from "@shared/agent-thread-runtime"
import type { FileMutationResultMetadata } from "@shared/file-mutation-result"
import {
  AgentActivityRow,
  AgentTool,
  AgentToolStatusBadge,
  type AgentToolState
} from "@/components/agent-ui"
import { useI18n } from "@/lib/i18n"
import type { HITLRequest, ToolCall } from "@/types"
import { createActionMessageView } from "./action-message-view"
import { type ToolPresentation, type ToolComponentStatus } from "./tools"

interface ActionMessageProps {
  toolCall: ToolCall
  activeToolCall?: ActiveAgentToolCall
  fileMutationResult?: FileMutationResultMetadata | null
  result?: unknown
  durationMs?: number | null
  approvalRequest?: HITLRequest | null
  onExpandedChange?: (expanded: boolean) => void
  defaultExpanded?: boolean
  expanded?: boolean
  presentation?: ToolPresentation
  showSummary?: boolean
  status?: ToolComponentStatus
}

function toAgentToolState(status: ToolComponentStatus): AgentToolState {
  switch (status) {
    case "approval":
      return "approval"
    case "complete":
      return "complete"
    case "failed":
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
  activeToolCall: ActiveAgentToolCall | undefined
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
    <span className="shrink-0 text-[var(--ow-agent-timeline-muted)] [font-size:var(--ow-font-caption)] tabular-nums">
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
    <span className="shrink-0 text-[var(--ow-agent-timeline-muted)] [font-size:var(--ow-font-caption)] tabular-nums">
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
    toolCall
  } = props
  const { copy } = useI18n()
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null)
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
      toolCall
    ]
  )
  const { definition, display, hasDetail, icon: Icon, model, status, statusLabel } = view
  const activityStatus = getActionMessageStatus(status, activeToolCall)
  const autoExpanded = Boolean(approvalRequest) || defaultExpanded
  const isExpanded = approvalRequest ? true : (expanded ?? manualExpanded ?? autoExpanded)
  const canExpandDetail = hasDetail && !approvalRequest
  const detail = useMemo<React.ReactNode>(() => {
    if (!canExpandDetail || !isExpanded) {
      return null
    }

    return (
      definition.renderDetail?.({
        copy,
        isExpanded,
        presentation,
        toolCall,
        ...model
      }) ?? null
    )
  }, [canExpandDetail, copy, definition, isExpanded, model, presentation, toolCall])

  const toolState = toAgentToolState(activityStatus)
  const statusMeta =
    statusLabel && toolState !== "complete" ? (
      <AgentToolStatusBadge state={toolState}>{statusLabel}</AgentToolStatusBadge>
    ) : null
  const detailContent = detail ? (
    <div className="min-w-0 max-w-full overflow-hidden">{detail}</div>
  ) : null
  const executionTime =
    activeToolCall?.status === "running" ? (
      <ToolExecutionTime active startedAt={activeToolCall.startedAt} />
    ) : activityStatus === "complete" || activityStatus === "failed" ? (
      <ToolDurationTime durationMs={durationMs} />
    ) : null
  const resultMeta = display.resultMeta ? (
    <span className="shrink-0 text-[var(--ow-agent-timeline-muted)] [font-size:var(--ow-font-caption)]">
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
    return detailContent
  }

  if (presentation === "grouped") {
    return (
      <div className="min-w-0">
        <button
          className="inline-flex max-w-full min-w-0 rounded-[var(--ow-radius-sm)] text-left text-[var(--ow-agent-timeline-muted)] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-active={isToolActive(activityStatus) ? "true" : undefined}
          data-tool-call-toggle={toolCall.name}
          onClick={() => {
            if (canExpandDetail) {
              const nextExpanded = !isExpanded
              onExpandedChange?.(nextExpanded)

              if (expanded === undefined) {
                setManualExpanded(nextExpanded)
              }
            }
          }}
          type="button"
        >
          <AgentActivityRow
            active={isToolActive(activityStatus)}
            className="w-full"
            detail={display.detail}
            icon={<Icon className="size-[var(--ow-icon-sm)]" />}
            label={display.title}
            meta={
              meta || canExpandDetail ? (
                <>
                  {meta}
                  {canExpandDetail ? (
                    <ChevronRight
                      className="ow-agent-tool-chevron size-[var(--ow-icon-sm)] text-[var(--ow-agent-timeline-muted)]"
                      data-open={isExpanded ? "true" : "false"}
                    />
                  ) : null}
                </>
              ) : null
            }
            trailingPlacement="inline"
          />
        </button>
        {canExpandDetail && isExpanded ? (
          <div className="mt-[var(--ow-space-2)] min-w-0 max-w-full pl-[calc(var(--ow-icon-action)+var(--ow-gap-sm))]">
            {detailContent}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <AgentTool
      data-tool-call-toggle={toolCall.name}
      defaultOpen={autoExpanded}
      detail={detailContent}
      hasDetail={canExpandDetail}
      icon={<Icon className="size-[var(--ow-icon-sm)]" />}
      meta={meta}
      onOpenChange={(nextExpanded) => {
        if (approvalRequest) {
          return
        }

        onExpandedChange?.(nextExpanded)

        if (expanded === undefined) {
          setManualExpanded(nextExpanded)
        }
      }}
      open={isExpanded}
      state={toolState}
      subtitle={display.detail}
      title={display.title}
    />
  )
}
