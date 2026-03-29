import { ChevronDown, ChevronRight, LoaderCircle, TriangleAlert } from "lucide-react"
import { useMemo, useState } from "react"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { HITLRequest, ToolCall } from "@/types"
import {
  defaultHumanInTheLoop,
  defaultToolComponent,
  getHumanInTheLoop,
  getToolComponent,
  type ToolComponentStatus
} from "./tools"
import { normalizeToolRenderModel } from "./tools/normalize"
import { ToolCodeBlock } from "./tools/shared-components"

interface ActionMessageProps {
  toolCall: ToolCall
  result?: unknown
  isError?: boolean
  approvalRequest?: HITLRequest | null
  onApprovalDecision?: (decision: "approve" | "reject" | "edit") => void
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

  return (
    <Icon
      className={cn(
        "size-3.5",
        status === "error" ? "text-status-critical" : "text-muted-foreground"
      )}
    />
  )
}

export function ActionMessage(props: ActionMessageProps): React.JSX.Element | null {
  const { approvalRequest, isError, onApprovalDecision, result, toolCall } = props
  const { copy } = useI18n()
  const [isExpanded, setIsExpanded] = useState(Boolean(approvalRequest))
  const model = useMemo(
    () =>
      normalizeToolRenderModel({
        approvalRequest,
        isError,
        result,
        toolCall
      }),
    [approvalRequest, isError, result, toolCall]
  )
  const { status } = model

  const definition = getToolComponent(toolCall.name) || defaultToolComponent
  const hitlDefinition = approvalRequest
    ? getHumanInTheLoop(toolCall.name) || defaultHumanInTheLoop
    : null
  const summary = definition.renderSummary({
    copy,
    isExpanded,
    toolCall,
    ...model
  })
  const detail = useMemo<React.ReactNode>(() => {
    if (approvalRequest && onApprovalDecision && hitlDefinition) {
      return hitlDefinition.render({
        copy,
        isExpanded,
        request: approvalRequest,
        respond: onApprovalDecision,
        toolCall,
        ...model
      })
    }

    const contentDetail = definition.renderDetail?.({
      copy,
      isExpanded,
      toolCall,
      ...model
    })

    if (status !== "error") {
      return contentDetail
    }

    const errorDetail = model.errorDetail ? (
      <ToolCodeBlock>{model.errorDetail}</ToolCodeBlock>
    ) : null

    if (!contentDetail && !errorDetail) {
      return null
    }

    return (
      <div className="grid gap-2.5">
        {contentDetail}
        {errorDetail}
      </div>
    )
  }, [
    approvalRequest,
    copy,
    definition,
    hitlDefinition,
    isExpanded,
    model,
    onApprovalDecision,
    status,
    toolCall
  ])

  const hasDetail = Boolean(detail)
  const statusLabel =
    status === "approval"
      ? copy.common.approval
      : status === "running"
        ? copy.common.running
        : status === "error"
          ? copy.common.error
          : null

  return (
    <div className="grid gap-1.5">
      <button
        className={cn(
          "flex w-full min-w-0 items-center gap-3 rounded-lg px-0 py-1 text-left transition-colors",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
        onClick={() => {
          if (hasDetail) {
            setIsExpanded((current) => !current)
          }
        }}
        type="button"
      >
        <span className="inline-flex size-4 shrink-0 items-center justify-center">
          <StatusGlyph Icon={definition.icon} status={status} />
        </span>

        <span className="min-w-0 flex-1 text-[13px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
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

      {hasDetail && isExpanded ? <div className="pl-7">{detail}</div> : null}
    </div>
  )
}
