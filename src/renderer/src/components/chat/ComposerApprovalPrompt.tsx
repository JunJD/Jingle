import { useMemo, useState } from "react"
import { ArrowUpRight, Check, FileDiff, Terminal, X } from "lucide-react"
import type { AppCopy } from "@/lib/i18n/messages"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { HITLDecision, HITLRequest } from "@/types"
import {
  getToolApprovalPresentationMeta,
  renderToolApprovalOverview
} from "./tools/tool-approval-presentation"
import { renderFileMutationApprovalDetail } from "./tools/file-mutation-presentation"

type ApprovalChoice = HITLDecision["type"]

function getApprovalTitle(copy: AppCopy, request: HITLRequest): string {
  if (request.review?.kind === "execute_command") {
    return copy.toolCall.approvalRunTitle
  }

  if (request.review?.kind === "file_mutation") {
    return copy.toolCall.approvalApplyTitle
  }

  return copy.toolCall.approvalConfirmTitle
}

function getApproveLabel(copy: AppCopy, request: HITLRequest): string {
  if (request.review?.kind === "execute_command") {
    return copy.toolCall.approveAndRun
  }

  if (request.review?.kind === "file_mutation") {
    return copy.toolCall.approveAndApply
  }

  return copy.toolCall.approve
}

function getChangeSummary(request: HITLRequest): string | null {
  const changes = request.review?.changes ?? []
  if (changes.length === 0) {
    return null
  }

  const createCount = changes.filter((change) => change.changeType === "create").length
  const modifyCount = changes.filter((change) => change.changeType === "modify").length
  const deleteCount = changes.filter((change) => change.changeType === "delete").length
  const [firstChange] = changes

  if (!firstChange) {
    return null
  }

  const prefix = changes.length === 1 ? firstChange.path : `${changes.length} files`
  const deltas = [
    createCount > 0 ? `+${createCount}` : null,
    modifyCount > 0 ? `~${modifyCount}` : null,
    deleteCount > 0 ? `-${deleteCount}` : null
  ].filter(Boolean)

  return deltas.length > 0 ? `${prefix} ${deltas.join(" ")}` : prefix
}

function getRawArgs(request: HITLRequest): string {
  return JSON.stringify(request.tool_call.args, null, 2)
}

function ComposerApprovalOption(props: {
  checked: boolean
  index: number
  label: string
  onSelect: () => void
  tone: "approve" | "reject"
}): React.JSX.Element {
  const { checked, index, label, onSelect, tone } = props

  return (
    <button
      type="button"
      className={cn(
        "group flex min-h-[30px] w-full items-center gap-[var(--ow-gap-md)] rounded-[var(--ow-radius-md)] px-[var(--ow-space-3)] text-left transition-colors",
        checked ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-foreground/5"
      )}
      onClick={onSelect}
    >
      <span className="[font-size:var(--ow-font-meta)] tabular-nums text-muted-foreground/70">
        {index}.
      </span>
      <span className="min-w-0 flex-1 truncate [font-size:var(--ow-font-body)] font-medium">
        {label}
      </span>
      <span
        className={cn(
          "flex size-[18px] shrink-0 items-center justify-center rounded-full border",
          checked
            ? tone === "approve"
              ? "border-foreground/20 bg-foreground text-background"
              : "border-destructive/30 bg-destructive text-destructive-foreground"
            : "border-transparent text-transparent"
        )}
      >
        {tone === "approve" ? <Check className="size-[12px]" /> : <X className="size-[12px]" />}
      </span>
    </button>
  )
}

export function ComposerApprovalPrompt(props: {
  className?: string
  density?: "default" | "compact"
  onDecision: (decision: HITLDecision) => void
  request: HITLRequest
}): React.JSX.Element {
  const { className, density = "default", onDecision, request } = props
  const { copy } = useI18n()
  const [choice, setChoice] = useState<ApprovalChoice>("approve")
  const [feedback, setFeedback] = useState("")
  const rawArgs = useMemo(() => getRawArgs(request), [request])
  const approvalItem = request.review
  const meta = getToolApprovalPresentationMeta(copy, approvalItem, request.tool_call.name)
  const detail =
    approvalItem?.kind === "file_mutation"
      ? renderFileMutationApprovalDetail(copy, approvalItem, { rawArgs })
      : renderToolApprovalOverview(copy, approvalItem, { rawArgs })
  const changeSummary = getChangeSummary(request)
  const Icon = request.review?.kind === "execute_command" ? Terminal : FileDiff
  const approveLabel = getApproveLabel(copy, request)
  const trimmedFeedback = feedback.trim()

  const submitDecision = (): void => {
    onDecision({
      type: choice,
      ...(choice === "reject" && trimmedFeedback ? { feedback: trimmedFeedback } : {})
    })
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[24px] border border-border/70 bg-background-elevated/95 shadow-[0_18px_42px_rgba(32,38,45,0.10)] backdrop-blur-xl",
        density === "compact" ? "rounded-[18px]" : null,
        className
      )}
    >
      <div
        className={cn(
          "grid gap-[var(--ow-space-3)]",
          density === "compact"
            ? "px-[var(--ow-space-3)] py-[var(--ow-space-3)]"
            : "px-[var(--ow-space-4)] py-[var(--ow-space-4)]"
        )}
      >
        <div className="flex min-w-0 items-start justify-between gap-[var(--ow-gap-md)]">
          <div className="grid min-w-0 gap-[var(--ow-space-1-5)]">
            <div className="flex min-w-0 items-center gap-[var(--ow-gap-sm)]">
              <Icon className="size-[var(--ow-icon-sm)] shrink-0 text-muted-foreground" />
              <div className="[font-size:var(--ow-font-control)] font-semibold leading-[var(--ow-line-body)] text-foreground">
                {getApprovalTitle(copy, request)}
              </div>
            </div>
            {meta.subtitle ? (
              <div className="min-w-0 truncate font-mono [font-size:var(--ow-font-meta)] text-muted-foreground">
                {meta.subtitle}
              </div>
            ) : null}
          </div>
          {changeSummary ? (
            <div className="flex shrink-0 items-center gap-[var(--ow-gap-xs)] rounded-full bg-foreground/5 px-[var(--ow-space-2-5)] py-[var(--ow-space-1)] [font-size:var(--ow-font-meta)] font-medium text-foreground">
              <span className="max-w-[180px] truncate">{changeSummary}</span>
              <ArrowUpRight className="size-[var(--ow-icon-xs)] text-muted-foreground" />
            </div>
          ) : null}
        </div>

        {detail ? (
          <div
            className={cn(
              "min-w-0 overflow-y-auto pr-[var(--ow-space-1)]",
              density === "compact" ? "max-h-[min(34vh,260px)]" : "max-h-[min(42vh,420px)]"
            )}
          >
            {detail}
          </div>
        ) : null}

        <div className="grid gap-[var(--ow-gap-xs)]">
          <ComposerApprovalOption
            checked={choice === "approve"}
            index={1}
            label={approveLabel}
            onSelect={() => setChoice("approve")}
            tone="approve"
          />
          <ComposerApprovalOption
            checked={choice === "reject"}
            index={2}
            label={copy.toolCall.rejectAndAdjust}
            onSelect={() => setChoice("reject")}
            tone="reject"
          />
        </div>

        {choice === "reject" ? (
          <textarea
            aria-label={copy.toolCall.rejectFeedbackPlaceholder}
            className="min-h-[72px] resize-none rounded-[var(--ow-radius-lg)] border border-border/70 bg-background-secondary/70 px-[var(--ow-space-3)] py-[var(--ow-space-2-5)] [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/25"
            onChange={(event) => setFeedback(event.target.value)}
            placeholder={copy.toolCall.rejectFeedbackPlaceholder}
            value={feedback}
          />
        ) : null}

        <div className="flex items-center justify-end gap-[var(--ow-gap-sm)]">
          <button
            type="button"
            className="rounded-full px-[var(--ow-space-3)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-body)] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            onClick={() =>
              onDecision({
                type: "reject",
                ...(trimmedFeedback ? { feedback: trimmedFeedback } : {})
              })
            }
          >
            {copy.toolCall.reject}
          </button>
          <button
            type="button"
            className="rounded-full bg-foreground px-[var(--ow-space-3)] py-[var(--ow-space-1-5)] [font-size:var(--ow-font-body)] font-semibold text-background shadow-[0_8px_20px_rgba(32,38,45,0.16)] transition-transform active:scale-[0.98]"
            onClick={submitDecision}
          >
            {copy.toolCall.approvalSubmit}
          </button>
        </div>
      </div>
    </div>
  )
}
