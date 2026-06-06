import { ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"
import { LoaderOne } from "@/components/ui/loader"
import {
  AgentTool,
  AgentToolInline,
  AgentToolStatusBadge,
  type AgentToolState
} from "@/components/agent-ui"
import { useI18n } from "@/lib/i18n"
import type { HITLRequest, ToolCall } from "@/types"
import { createActionMessageView } from "./action-message-view"
import { type ToolPresentation, type ToolComponentStatus } from "./tools"

interface ActionMessageProps {
  toolCall: ToolCall
  result?: unknown
  approvalRequest?: HITLRequest | null
  onExpandedChange?: (expanded: boolean) => void
  defaultExpanded?: boolean
  expanded?: boolean
  presentation?: ToolPresentation
  showSummary?: boolean
  status?: ToolComponentStatus
}

export function ToolStatusIndicator(props: {
  runningLabel: string
  status: ToolComponentStatus
  statusLabel: string | null
}): React.JSX.Element | null {
  const { runningLabel, status, statusLabel } = props

  if (status === "running") {
    return (
      <span
        aria-label={runningLabel}
        className="inline-flex h-[var(--ow-space-4)] w-[var(--launcher-action-control-h)] shrink-0 items-center justify-center"
        role="status"
      >
        <LoaderOne />
      </span>
    )
  }

  return statusLabel ? <span>{statusLabel}</span> : null
}

function toAgentToolState(status: ToolComponentStatus): AgentToolState {
  switch (status) {
    case "approval":
      return "approval"
    case "complete":
      return "complete"
    case "running":
      return "running"
  }
}

export function ActionMessage(props: ActionMessageProps): React.JSX.Element | null {
  const {
    approvalRequest,
    defaultExpanded = false,
    expanded,
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
        approvalRequest,
        copy,
        presentation,
        result,
        status: explicitStatus,
        toolCall
      }),
    [approvalRequest, copy, explicitStatus, presentation, result, toolCall]
  )
  const { definition, icon: Icon, model, status, statusLabel, summary } = view
  const autoExpanded = Boolean(approvalRequest) || defaultExpanded
  const isExpanded = approvalRequest ? true : (expanded ?? manualExpanded ?? autoExpanded)
  const detail = useMemo<React.ReactNode>(() => {
    if (approvalRequest) {
      return null
    }

    const contentDetail = definition.renderDetail?.({
      copy,
      isExpanded,
      presentation,
      toolCall,
      ...model
    })
    return contentDetail
  }, [approvalRequest, copy, definition, isExpanded, model, presentation, toolCall])

  const hasDetail = Boolean(detail)
  const toolState = toAgentToolState(status)
  const meta =
    statusLabel && toolState !== "complete" ? (
      <AgentToolStatusBadge state={toolState}>{statusLabel}</AgentToolStatusBadge>
    ) : null
  const detailContent = hasDetail ? (
    <div className="min-w-0 max-w-full overflow-hidden">{detail}</div>
  ) : null

  if (!showSummary) {
    return hasDetail && isExpanded ? detailContent : null
  }

  if (presentation === "grouped") {
    return (
      <div className="min-w-0">
        <AgentToolInline
          active={toolState === "running"}
          data-tool-call-toggle={toolCall.name}
          meta={
            <>
              {meta}
              {hasDetail ? (
                <ChevronRight
                  className="ow-agent-tool-chevron size-[var(--ow-icon-sm)] text-[var(--ow-agent-timeline-muted)]"
                  data-open={isExpanded ? "true" : "false"}
                />
              ) : null}
            </>
          }
          onClick={() => {
            if (hasDetail && !approvalRequest) {
              const nextExpanded = !isExpanded
              onExpandedChange?.(nextExpanded)

              if (expanded === undefined) {
                setManualExpanded(nextExpanded)
              }
            }
          }}
          title={summary}
        />
        {hasDetail && isExpanded ? (
          <div className="mt-[var(--ow-space-2)] pl-[calc(var(--ow-icon-action)+var(--ow-gap-sm))]">
            {detailContent}
          </div>
        ) : null}
      </div>
    )
  }

  if (toolState === "complete" && !isExpanded) {
    return (
      <AgentToolInline
        data-tool-call-toggle={toolCall.name}
        icon={<Icon className="size-[var(--ow-icon-sm)]" />}
        meta={
          hasDetail ? (
            <ChevronRight
              className="ow-agent-tool-chevron size-[var(--ow-icon-sm)] text-[var(--ow-agent-timeline-muted)]"
              data-open="false"
            />
          ) : null
        }
        onClick={() => {
          if (hasDetail && !approvalRequest) {
            onExpandedChange?.(true)

            if (expanded === undefined) {
              setManualExpanded(true)
            }
          }
        }}
        title={summary}
      />
    )
  }

  return (
    <AgentTool
      data-tool-call-toggle={toolCall.name}
      defaultOpen={autoExpanded}
      detail={detailContent}
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
      title={summary}
    />
  )
}
