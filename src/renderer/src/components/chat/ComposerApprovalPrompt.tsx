import { useState } from "react"
import { ArrowUpRight, FileDiff, Terminal } from "lucide-react"
import { getHitlRequestDisplaySize } from "@shared/hitl"
import type { AppCopy } from "@/lib/i18n/messages"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { HITLDecision, HITLRequest } from "@/types"
import { ComposerInterruptShell } from "./ComposerInterruptShell"
import {
  getCompactToolApprovalPresentation,
  getToolApprovalPresentationMeta
} from "./tools/tool-approval-presentation"
import { LargeApprovalBody } from "./tools/approval-large-presentation"
import { stringifyToolValue } from "./tools/shared"

function getApprovalTitle(metaTitle: string): string {
  return metaTitle
}

function getApproveLabel(copy: AppCopy, request: HITLRequest): string {
  return request.review?.kind === "execute_command"
    ? copy.toolCall.approveAndRun
    : copy.toolCall.approve
}

export function ComposerApprovalPrompt(props: {
  actionsPlacement?: "inline" | "external"
  className?: string
  density?: "default" | "compact"
  onDecision: (decision: HITLDecision) => void
  rejectFeedback?: string
  rejectFeedbackPlacement?: "inline" | "external"
  request: HITLRequest
  variant?: "default" | "composer-tray"
}): React.JSX.Element {
  const {
    actionsPlacement = "inline",
    className,
    density = "default",
    onDecision,
    rejectFeedback,
    rejectFeedbackPlacement = "inline",
    request,
    variant = "default"
  } = props
  const { copy } = useI18n()
  const [feedback, setFeedback] = useState("")
  const [rejecting, setRejecting] = useState(false)
  const usesExternalActions = actionsPlacement === "external"
  const usesExternalRejectFeedback = rejectFeedbackPlacement === "external"
  const approvalItem = request.review
  const meta = getToolApprovalPresentationMeta(copy, approvalItem, request.tool_call.name)
  const compact = getCompactToolApprovalPresentation(
    copy,
    approvalItem,
    meta.subtitle,
    request.tool_call.id
  )
  const Icon =
    request.review?.kind === "execute_command"
      ? Terminal
      : request.review?.kind === "extension_tool"
        ? ArrowUpRight
        : FileDiff
  const approveLabel = getApproveLabel(copy, request)
  const trimmedFeedback = usesExternalRejectFeedback
    ? (rejectFeedback ?? "").trim()
    : feedback.trim()
  const displaySize = getHitlRequestDisplaySize(request)
  const isLarge = displaySize === "large"
  const rawArgs = stringifyToolValue(request.tool_call.args)
  const largeBody = isLarge ? (
    <LargeApprovalBody
      approvalItem={approvalItem}
      copy={copy}
      rawArgs={rawArgs}
      toolCallId={request.tool_call.id}
    />
  ) : null
  const actions = usesExternalActions ? null : (
    <div className="grid gap-[var(--jingle-space-2)]">
      {rejecting && !usesExternalRejectFeedback ? (
        <textarea
          aria-label={copy.toolCall.rejectFeedbackPlaceholder}
          autoFocus
          className="min-h-[52px] resize-none rounded-[var(--jingle-radius-md)] border border-border/60 bg-background-secondary/45 px-[var(--jingle-space-2-5)] py-[var(--jingle-space-2)] [font-size:var(--jingle-font-body)] leading-[var(--jingle-line-chat)] text-foreground outline-none placeholder:text-muted-foreground/65 focus:border-foreground/25"
          onChange={(event) => setFeedback(event.target.value)}
          placeholder={copy.toolCall.rejectFeedbackPlaceholder}
          value={feedback}
        />
      ) : null}

      <div className="flex items-center justify-end gap-[var(--jingle-gap-sm)]">
        {rejecting && !usesExternalRejectFeedback ? (
          <button
            type="button"
            className="min-h-8 rounded-full px-[var(--jingle-space-2-5)] [font-size:var(--jingle-font-body)] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            onClick={() => {
              setFeedback("")
              setRejecting(false)
            }}
          >
            {copy.apiKeyDialog.cancel}
          </button>
        ) : null}
        <button
          type="button"
          className="min-h-8 rounded-full px-[var(--jingle-space-3)] [font-size:var(--jingle-font-body)] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          onClick={() => {
            if (!usesExternalRejectFeedback && !rejecting && isLarge) {
              setRejecting(true)
              return
            }

            onDecision({
              type: "reject",
              ...(trimmedFeedback ? { feedback: trimmedFeedback } : {})
            })
          }}
        >
          {copy.toolCall.reject}
        </button>
        <button
          type="button"
          className="min-h-8 rounded-full bg-foreground px-[var(--jingle-space-3)] [font-size:var(--jingle-font-body)] font-semibold text-background shadow-[0_6px_16px_rgba(32,38,45,0.14)] transition-transform active:scale-[0.98]"
          onClick={() => onDecision({ type: "approve" })}
        >
          {approveLabel}
        </button>
      </div>
    </div>
  )

  return (
    <ComposerInterruptShell
      actions={actions}
      body={largeBody}
      className={cn(
        variant === "composer-tray" &&
          "rounded-b-none border-border/70 bg-background-elevated/92 shadow-[0_1px_0_rgba(32,38,45,0.05)]",
        className
      )}
      density={density}
      header={
        <div className="flex min-w-0 items-center justify-between gap-[var(--jingle-gap-md)]">
          <div className="flex min-w-0 items-center gap-[var(--jingle-gap-sm)]">
            <Icon className="size-[var(--jingle-icon-sm)] shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="[font-size:var(--jingle-font-body)] font-semibold leading-[var(--jingle-line-body)] text-foreground">
                {getApprovalTitle(meta.title)}
              </div>
              {compact.target ? (
                <div className="min-w-0 truncate font-mono [font-size:var(--jingle-font-meta)] leading-[var(--jingle-line-body)] text-muted-foreground">
                  {compact.target}
                </div>
              ) : null}
            </div>
          </div>
          {compact.summary ? (
            <div className="hidden shrink-0 items-center gap-[var(--jingle-gap-xs)] rounded-full bg-foreground/5 px-[var(--jingle-space-2)] py-[var(--jingle-space-1)] [font-size:var(--jingle-font-meta)] font-medium text-foreground sm:flex">
              <span>{compact.summary}</span>
              <ArrowUpRight className="size-[var(--jingle-icon-xs)] text-muted-foreground" />
            </div>
          ) : null}
        </div>
      }
      size={displaySize}
    />
  )
}
