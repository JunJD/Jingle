import { ChevronDown, ChevronRight, LoaderCircle, TriangleAlert } from "lucide-react"
import { useMemo, useState } from "react"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { HITLDecision, HITLRequest, ToolCall } from "@/types"
import { createActionMessageView } from "./action-message-view"
import { type ToolPresentation, type ToolComponentStatus } from "./tools"

interface ActionMessageProps {
  toolCall: ToolCall
  result?: unknown
  approvalRequest?: HITLRequest | null
  onApprovalDecision?: (decision: HITLDecision) => void
  presentation?: ToolPresentation
}

function StatusGlyph(props: {
  status: ToolComponentStatus
  Icon: React.ComponentType<{ className?: string }>
}): React.JSX.Element {
  const { Icon, status } = props

  if (status === "running") {
    return <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
  }

  if (status === "approval") {
    return <TriangleAlert className="size-3.5 text-status-warning" />
  }

  return <Icon className={cn("size-3.5 text-muted-foreground")} />
}

export function ActionMessage(props: ActionMessageProps): React.JSX.Element | null {
  const {
    approvalRequest,
    onApprovalDecision,
    presentation = "standalone",
    result,
    toolCall
  } = props
  const { copy } = useI18n()
  const [manualExpanded, setManualExpanded] = useState(Boolean(approvalRequest))
  const view = useMemo(
    () =>
      createActionMessageView({
        approvalRequest,
        copy,
        presentation,
        result,
        toolCall
      }),
    [approvalRequest, copy, presentation, result, toolCall]
  )
  const { definition, hitlDefinition, icon, model, status, summary } = view
  const isExpanded = Boolean(approvalRequest) || manualExpanded
  const showLeadingIcon = presentation !== "grouped"
  const detail = useMemo<React.ReactNode>(() => {
    if (approvalRequest && onApprovalDecision && hitlDefinition) {
      return hitlDefinition.render({
        copy,
        isExpanded,
        presentation,
        request: approvalRequest,
        respond: onApprovalDecision,
        toolCall,
        ...model
      })
    }

    const contentDetail = definition.renderDetail?.({
      copy,
      isExpanded,
      presentation,
      toolCall,
      ...model
    })
    return contentDetail
  }, [
    approvalRequest,
    copy,
    definition,
    hitlDefinition,
    isExpanded,
    model,
    onApprovalDecision,
    presentation,
    toolCall
  ])

  const hasDetail = Boolean(detail)
  const statusLabel =
    status === "approval" ? copy.common.approval : status === "running" ? copy.common.running : null

  return (
    <div
      className={cn("grid min-w-0 max-w-full", presentation === "grouped" ? "gap-1" : "gap-1.5")}
    >
      <button
        className={cn(
          "inline-flex max-w-full min-w-0 items-center gap-3 rounded-lg px-0 text-left transition-colors",
          presentation === "grouped" ? "py-0.5" : "py-1",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
        onClick={() => {
          if (hasDetail && !approvalRequest) {
            setManualExpanded((current) => !current)
          }
        }}
        type="button"
      >
        {showLeadingIcon ? (
          <span className="inline-flex size-4 shrink-0 items-center justify-center">
            <StatusGlyph Icon={icon} status={status} />
          </span>
        ) : null}

        <span className="min-w-0 text-[13px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          {summary}
        </span>

        <span className="flex shrink-0 items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {statusLabel ? <span>{statusLabel}</span> : null}
          {hasDetail ? (
            isExpanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )
          ) : null}
        </span>
      </button>

      {hasDetail && isExpanded ? (
        <div
          className={cn(
            "min-w-0 max-w-full overflow-hidden",
            presentation === "grouped" ? "pl-0" : "pl-7"
          )}
        >
          {detail}
        </div>
      ) : null}
    </div>
  )
}
