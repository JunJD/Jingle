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
import { stringifyToolValue, truncateMiddle } from "./shared"

export interface LargeApprovalAction {
  detail: string | null
  presentation: "command" | "text"
  title: string
}

export interface LargeApprovalFact {
  label: string
  presentation?: "mono" | "path" | "preview" | "text"
  value: string
}

export interface LargeApprovalImpact {
  detail: string | null
  label: string
  tone?: "neutral" | "success" | "warning" | "destructive"
}

export interface LargeApprovalViewModel {
  action: LargeApprovalAction | null
  impact: LargeApprovalImpact[]
  parameters: LargeApprovalFact[]
  target: LargeApprovalFact[]
}

function getChangeTone(changeType: "create" | "modify" | "delete"): LargeApprovalImpact["tone"] {
  switch (changeType) {
    case "create":
      return "success"
    case "delete":
      return "destructive"
    case "modify":
      return "warning"
  }
}

function getChangeLabel(copy: AppCopy, changeType: "create" | "modify" | "delete"): string {
  switch (changeType) {
    case "create":
      return copy.toolCall.changeCreate
    case "delete":
      return copy.toolCall.changeDelete
    case "modify":
      return copy.toolCall.changeModify
  }
}

function getActionTitle(copy: AppCopy, approvalItem: ToolApprovalItem): string {
  return (
    copy.toolCall.labels[approvalItem.toolName] ||
    (approvalItem.kind === "extension_tool" ? approvalItem.toolTitle : null) ||
    approvalItem.toolName
  )
}

function buildChangeImpact(
  copy: AppCopy,
  approvalItem: Extract<ToolApprovalItem, { kind: "execute_command" | "file_mutation" }>
): LargeApprovalImpact[] {
  return approvalItem.changes.map((change) => ({
    detail: change.path,
    label: getChangeLabel(copy, change.changeType),
    tone: getChangeTone(change.changeType)
  }))
}

function buildPathTargets(
  copy: AppCopy,
  approvalItem: Extract<ToolApprovalItem, { kind: "execute_command" | "file_mutation" }>
): LargeApprovalFact[] {
  if (approvalItem.kind === "file_mutation") {
    return approvalItem.path
      ? [
          {
            label: copy.toolCall.fileReviewPath,
            presentation: "path",
            value: approvalItem.path
          }
        ]
      : []
  }

  return approvalItem.changes.map((change) => ({
    label: copy.toolCall.fileReviewPath,
    presentation: "path",
    value: change.path
  }))
}

function buildExecuteLargeApprovalViewModel(
  copy: AppCopy,
  approvalItem: Extract<ToolApprovalItem, { kind: "execute_command" }>
): LargeApprovalViewModel {
  const parameters: LargeApprovalFact[] = []

  if (approvalItem.profile) {
    parameters.push({
      label: copy.toolCall.approvalProfile,
      presentation: "mono",
      value: approvalItem.profile
    })
  }

  if (approvalItem.predictionStatus) {
    parameters.push({
      label: copy.toolCall.approvalPrediction,
      presentation: "mono",
      value: approvalItem.predictionStatus
    })
  }

  return {
    action: approvalItem.command
      ? {
          detail: approvalItem.command,
          presentation: "command",
          title: getActionTitle(copy, approvalItem)
        }
      : {
          detail: null,
          presentation: "text",
          title: getActionTitle(copy, approvalItem)
        },
    impact: buildChangeImpact(copy, approvalItem),
    parameters,
    target: buildPathTargets(copy, approvalItem)
  }
}

function buildFileMutationLargeApprovalViewModel(
  copy: AppCopy,
  approvalItem: Extract<ToolApprovalItem, { kind: "file_mutation" }>
): LargeApprovalViewModel {
  const parameters: LargeApprovalFact[] = []

  if (approvalItem.oldText !== null) {
    parameters.push({
      label: copy.toolCall.fileReviewOriginal,
      presentation: "preview",
      value: approvalItem.oldText
    })
  }

  if (approvalItem.newText !== null) {
    parameters.push({
      label: copy.toolCall.fileReviewUpdated,
      presentation: "preview",
      value: approvalItem.newText
    })
  }

  if (approvalItem.content !== null) {
    parameters.push({
      label: copy.toolCall.fileReviewContent,
      presentation: "preview",
      value: approvalItem.content
    })
  }

  return {
    action: {
      detail: null,
      presentation: "text",
      title: getActionTitle(copy, approvalItem)
    },
    impact: buildChangeImpact(copy, approvalItem),
    parameters,
    target: buildPathTargets(copy, approvalItem)
  }
}

function buildExtensionLargeApprovalViewModel(
  copy: AppCopy,
  approvalItem: Extract<ToolApprovalItem, { kind: "extension_tool" }>
): LargeApprovalViewModel {
  const confirmationFacts =
    approvalItem.confirmation?.facts.map((fact) => ({
      label: fact.label,
      presentation: fact.mono ? ("mono" as const) : ("text" as const),
      value: fact.value
    })) ?? []
  const parameters: LargeApprovalFact[] = [...confirmationFacts]
  const confirmationFactLabels = new Set(confirmationFacts.map((fact) => fact.label))

  for (const [key, value] of Object.entries(approvalItem.args)) {
    if (key.startsWith("__") || confirmationFactLabels.has(key)) {
      continue
    }

    const normalized = stringifyToolValue(value).trim()
    if (!normalized) {
      continue
    }

    parameters.push({
      label: key,
      presentation: normalized.includes("\n") || normalized.length > 48 ? "mono" : "text",
      value: normalized
    })
  }

  return {
    action: {
      detail: approvalItem.toolName,
      presentation: "text",
      title: approvalItem.confirmation?.title ?? getActionTitle(copy, approvalItem)
    },
    impact: [
      approvalItem.confirmation?.message
        ? ({
            detail: approvalItem.confirmation.message,
            label: copy.toolCall.approvalReason,
            tone:
              approvalItem.confirmation.tone === "danger"
                ? "destructive"
                : approvalItem.confirmation.tone === "warning"
                  ? "warning"
                  : "neutral"
          } satisfies LargeApprovalImpact)
        : null,
      approvalItem.reason
        ? {
            detail: approvalItem.reason,
            label: copy.toolCall.approvalReason,
            tone: "warning" as const
          }
        : null
    ].filter((entry) => entry !== null),
    parameters,
    target: approvalItem.capabilityDisplayName
      ? [
          {
            label: copy.toolCall.approvalSource,
            value: approvalItem.capabilityDisplayName
          }
        ]
      : []
  }
}

export function buildLargeApprovalViewModel(
  copy: AppCopy,
  approvalItem: ToolApprovalItem | null,
  rawArgs: string
): LargeApprovalViewModel {
  if (!approvalItem) {
    return {
      action: null,
      impact: [],
      parameters: rawArgs
        ? [
            {
              label: copy.common.rawArguments,
              presentation: "mono",
              value: rawArgs
            }
          ]
        : [],
      target: []
    }
  }

  if (approvalItem.kind === "execute_command") {
    return buildExecuteLargeApprovalViewModel(copy, approvalItem)
  }

  if (approvalItem.kind === "file_mutation") {
    return buildFileMutationLargeApprovalViewModel(copy, approvalItem)
  }

  return buildExtensionLargeApprovalViewModel(copy, approvalItem)
}

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
    viewModel.target.length === 0 &&
    viewModel.impact.length === 0 &&
    viewModel.parameters.length === 0
  ) {
    return null
  }

  return (
    <ToolDetailStack>
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
      {viewModel.parameters.length > 0 ? (
        <ToolDetailSection label={copy.toolCall.approvalParameters}>
          <ApprovalParameterList items={viewModel.parameters} />
        </ToolDetailSection>
      ) : null}
    </ToolDetailStack>
  )
}

export function renderLargeApprovalBody(input: {
  approvalItem: ToolApprovalItem | null
  copy: AppCopy
  rawArgs: string
}): React.JSX.Element | null {
  const { approvalItem, copy, rawArgs } = input
  return renderLargeApprovalViewModel(
    copy,
    buildLargeApprovalViewModel(copy, approvalItem, rawArgs)
  )
}
