import type { AppCopy } from "@/lib/i18n/messages"
import type { ToolApprovalItem } from "@shared/tool-approval"
import { stringifyToolValue } from "./shared"

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
    impact: [
      ...buildChangeImpact(copy, approvalItem),
      approvalItem.reason
        ? {
            detail: approvalItem.reason,
            label: copy.toolCall.approvalReason,
            tone:
              approvalItem.profile === "unknown_command"
                ? ("warning" as const)
                : ("neutral" as const)
          }
        : null
    ].filter((entry) => entry !== null),
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
