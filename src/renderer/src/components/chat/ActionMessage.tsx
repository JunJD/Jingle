import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react"
import { useMemo, useState } from "react"
import { LoaderOne } from "@/components/ui/loader"
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
  onExpandedChange?: (expanded: boolean) => void
  density?: "default" | "compact"
  defaultExpanded?: boolean
  expanded?: boolean
  presentation?: ToolPresentation
  showSummary?: boolean
}

function StatusGlyph(props: {
  status: ToolComponentStatus
  Icon: React.ComponentType<{ className?: string }>
}): React.JSX.Element {
  const { Icon, status } = props

  if (status === "approval") {
    return <TriangleAlert className="size-[var(--ow-icon-sm)] text-status-warning" />
  }

  return <Icon className={cn("size-[var(--ow-icon-sm)] text-muted-foreground")} />
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

export function ActionMessage(props: ActionMessageProps): React.JSX.Element | null {
  const {
    approvalRequest,
    defaultExpanded = false,
    density = "default",
    expanded,
    onApprovalDecision,
    onExpandedChange,
    presentation = "standalone",
    result,
    showSummary = true,
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
        toolCall
      }),
    [approvalRequest, copy, presentation, result, toolCall]
  )
  const { definition, hitlDefinition, icon, model, status, statusLabel, summary } = view
  const autoExpanded = Boolean(approvalRequest) || defaultExpanded
  const isExpanded = approvalRequest ? true : (expanded ?? manualExpanded ?? autoExpanded)
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
  const detailContent =
    hasDetail && isExpanded ? (
      <div
        className={cn(
          "min-w-0 max-w-full overflow-hidden",
          presentation === "grouped" ? "pl-0" : "pl-[var(--ow-chat-action-indent)]"
        )}
      >
        {detail}
      </div>
    ) : null

  if (!showSummary) {
    return detailContent
  }

  return (
    <div
      className={cn(
        "grid min-w-0 max-w-full",
        presentation === "grouped" ? "gap-[var(--ow-gap-xs)]" : "gap-[var(--ow-space-1-5)]"
      )}
    >
      <button
        className={cn(
          "inline-flex max-w-full min-w-0 items-center gap-[var(--ow-gap-md)] rounded-lg px-0 text-left transition-colors",
          presentation === "grouped" ? "py-[var(--ow-space-0-5)]" : "py-[var(--ow-space-1)]",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
        data-tool-call-toggle={toolCall.name}
        onClick={() => {
          if (hasDetail && !approvalRequest) {
            const nextExpanded = !isExpanded
            onExpandedChange?.(nextExpanded)

            if (expanded === undefined) {
              setManualExpanded(nextExpanded)
            }
          }
        }}
        type="button"
      >
        {showLeadingIcon ? (
          <span className="inline-flex size-[var(--ow-icon-action)] shrink-0 items-center justify-center">
            <StatusGlyph Icon={icon} status={status} />
          </span>
        ) : null}

        <span
          className={cn(
            "min-w-0 [overflow-wrap:anywhere]",
            density === "compact"
              ? "[font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-muted-foreground"
              : "[font-size:var(--ow-font-control)] leading-[var(--ow-line-chat)] text-muted-foreground"
          )}
        >
          {summary}
        </span>

        <span
          className={cn(
            "flex shrink-0 items-center gap-[var(--ow-gap-sm)] font-medium uppercase tracking-[0.08em] text-muted-foreground",
            density === "compact"
              ? "[font-size:var(--ow-font-caption)]"
              : "[font-size:var(--ow-font-meta)]"
          )}
        >
          <ToolStatusIndicator
            runningLabel={copy.common.running}
            status={status}
            statusLabel={statusLabel}
          />
          {hasDetail ? (
            isExpanded ? (
              <ChevronDown className="size-[var(--ow-icon-sm)]" />
            ) : (
              <ChevronRight className="size-[var(--ow-icon-sm)]" />
            )
          ) : null}
        </span>
      </button>

      {detailContent}
    </div>
  )
}
