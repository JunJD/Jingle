import React from "react"
import {
  ToolCodeBlock,
  ToolCollapsibleSection,
  ToolDetailSection,
  ToolDetailStack,
  ToolPreviewLines
} from "./shared-components"
import type { AppCopy } from "@/lib/i18n/messages"
import type { ToolApprovalItem } from "@shared/tool-approval"
import { cn } from "@/lib/utils"
import { truncateMiddle } from "./shared"
import {
  buildLargeApprovalViewModel,
  type LargeApprovalAction,
  type LargeApprovalConfirmation,
  type LargeApprovalFact,
  type LargeApprovalImpact,
  type LargeApprovalViewModel
} from "./approval-large-view-model"
import { PierreFileMutationView } from "./PierreFileMutationView"

function ApprovalActionBlock(props: { action: LargeApprovalAction }): React.JSX.Element {
  const { action } = props

  if (action.presentation === "command" && action.detail) {
    return <ToolCodeBlock>{`$ ${action.detail}`}</ToolCodeBlock>
  }

  return (
    <div className="rounded-[var(--ow-radius-md)] bg-background-secondary/42 px-[var(--ow-space-2-5)] py-[var(--ow-space-2)]">
      <div className="[font-size:var(--ow-font-body)] font-medium leading-[var(--ow-line-body)] text-foreground">
        {action.title}
      </div>
      {action.detail ? (
        <div className="mt-[var(--ow-space-1)] min-w-0 break-all font-mono [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-muted-foreground">
          {truncateMiddle(action.detail, 120)}
        </div>
      ) : null}
    </div>
  )
}

function ApprovalImpactList(props: { items: LargeApprovalImpact[] }): React.JSX.Element | null {
  const { items } = props

  if (items.length === 0) {
    return null
  }

  return (
    <div className="grid gap-[var(--ow-space-1-5)]">
      {items.map((item, index) => (
        <div
          key={`${item.label}:${item.detail ?? index}`}
          className="flex min-w-0 items-start gap-[var(--ow-gap-sm)] rounded-[var(--ow-radius-md)] bg-background-secondary/42 px-[var(--ow-space-2-5)] py-[var(--ow-space-2)]"
        >
          <span
            className={cn(
              "shrink-0 rounded-full px-[var(--ow-space-1-5)] py-[var(--ow-space-0-5)] [font-size:var(--ow-font-caption)] font-medium leading-none",
              item.tone === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              item.tone === "warning" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
              item.tone === "destructive" && "bg-destructive/10 text-destructive",
              (!item.tone || item.tone === "neutral") && "bg-foreground/5 text-muted-foreground"
            )}
          >
            {item.label}
          </span>
          {item.detail ? (
            <span className="min-w-0 break-all font-mono [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-foreground/78">
              {truncateMiddle(item.detail, 120)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function ApprovalConfirmationBlock(props: {
  confirmation: LargeApprovalConfirmation
}): React.JSX.Element | null {
  const { confirmation } = props
  const heading = confirmation.message ?? confirmation.title

  if (!heading && confirmation.facts.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--ow-radius-md)] border bg-background-secondary/38",
        confirmation.tone === "danger" && "border-destructive/24 bg-destructive/4",
        confirmation.tone === "warning" && "border-amber-500/24 bg-amber-500/5",
        (!confirmation.tone || confirmation.tone === "default") && "border-border/58"
      )}
    >
      {heading ? (
        <div className="px-[var(--ow-space-3)] py-[var(--ow-space-2-5)] [font-size:var(--ow-font-body)] font-medium leading-[var(--ow-line-body)] text-foreground">
          {heading}
        </div>
      ) : null}
      {confirmation.facts.length > 0 ? (
        <div className="divide-y divide-border/55">
          {confirmation.facts.map((fact, index) => (
            <div
              key={`${fact.label}:${fact.value}:${index}`}
              className="grid min-w-0 grid-cols-[minmax(88px,0.34fr)_minmax(0,1fr)] gap-[var(--ow-gap-md)] px-[var(--ow-space-3)] py-[var(--ow-space-2-5)]"
            >
              <div className="[font-size:var(--ow-font-meta)] font-medium leading-[var(--ow-line-body)] text-muted-foreground">
                {fact.label}
              </div>
              <div
                className={cn(
                  "min-w-0 whitespace-pre-wrap text-left [font-size:var(--ow-font-body)] leading-[var(--ow-line-chat)] text-foreground/86 [overflow-wrap:anywhere]",
                  fact.presentation === "mono" && "font-mono [font-size:var(--ow-font-meta)]"
                )}
              >
                {fact.value}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ApprovalFactList(props: { items: LargeApprovalFact[] }): React.JSX.Element | null {
  const { items } = props

  if (items.length === 0) {
    return null
  }

  return (
    <div className="grid gap-[var(--ow-space-1-5)]">
      {items.map((item, index) => (
        <div
          key={`${item.label}:${item.value}:${index}`}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-[var(--ow-gap-md)] rounded-[var(--ow-radius-md)] bg-background-secondary/42 px-[var(--ow-space-2-5)] py-[var(--ow-space-2)]"
        >
          <div className="[font-size:var(--ow-font-meta)] font-medium leading-[var(--ow-line-body)] text-muted-foreground">
            {item.label}
          </div>
          <div
            className={cn(
              "min-w-0 break-words text-right [font-size:var(--ow-font-meta)] leading-[var(--ow-line-body)] text-foreground/80",
              (item.presentation === "mono" || item.presentation === "path") &&
                "font-mono whitespace-pre-wrap"
            )}
          >
            {item.presentation === "path" ? truncateMiddle(item.value, 120) : item.value}
          </div>
        </div>
      ))}
    </div>
  )
}

function ApprovalParameterList(props: { items: LargeApprovalFact[] }): React.JSX.Element | null {
  const { items } = props
  const inlineItems = items.filter((item) => item.presentation !== "preview")
  const previewItems = items.filter((item) => item.presentation === "preview")

  if (items.length === 0) {
    return null
  }

  return (
    <ToolDetailStack>
      <ApprovalFactList items={inlineItems} />
      {previewItems.map((item) => (
        <ToolCollapsibleSection key={item.label} label={item.label} summary={item.label}>
          <ToolPreviewLines text={item.value} maxLines={10} />
        </ToolCollapsibleSection>
      ))}
    </ToolDetailStack>
  )
}

function renderLargeApprovalViewModel(
  copy: AppCopy,
  viewModel: LargeApprovalViewModel
): React.JSX.Element | null {
  if (
    !viewModel.action &&
    !viewModel.confirmation &&
    !viewModel.fileMutation &&
    viewModel.target.length === 0 &&
    viewModel.impact.length === 0 &&
    viewModel.parameters.length === 0
  ) {
    return null
  }

  return (
    <ToolDetailStack>
      {viewModel.confirmation ? (
        <ApprovalConfirmationBlock confirmation={viewModel.confirmation} />
      ) : null}
      {viewModel.action ? (
        <ToolDetailSection label={copy.toolCall.approvalAction}>
          <ApprovalActionBlock action={viewModel.action} />
        </ToolDetailSection>
      ) : null}
      {viewModel.target.length > 0 ? (
        <ToolDetailSection label={copy.toolCall.approvalTarget}>
          <ApprovalFactList items={viewModel.target} />
        </ToolDetailSection>
      ) : null}
      {viewModel.impact.length > 0 ? (
        <ToolDetailSection label={copy.toolCall.approvalImpact}>
          <ApprovalImpactList items={viewModel.impact} />
        </ToolDetailSection>
      ) : null}
      {viewModel.fileMutation ? (
        <ToolDetailSection label={copy.toolCall.upcomingChanges}>
          <PierreFileMutationView viewModel={viewModel.fileMutation} />
        </ToolDetailSection>
      ) : null}
      {viewModel.parameters.length > 0 ? (
        <ToolDetailSection label={copy.toolCall.approvalParameters}>
          <ApprovalParameterList items={viewModel.parameters} />
        </ToolDetailSection>
      ) : null}
    </ToolDetailStack>
  )
}

export function LargeApprovalBody(input: {
  approvalItem: ToolApprovalItem | null
  copy: AppCopy
  rawArgs: string
  toolCallId: string
}): React.JSX.Element | null {
  const { approvalItem, copy, rawArgs, toolCallId } = input
  return renderLargeApprovalViewModel(
    copy,
    buildLargeApprovalViewModel(copy, approvalItem, rawArgs, toolCallId)
  )
}
