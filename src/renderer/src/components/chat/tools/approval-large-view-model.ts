import type { AppCopy } from "@/lib/i18n/messages"
import type { ToolApprovalItem } from "@shared/tool-approval"
import { stringifyToolValue } from "./shared"
import {
  buildApprovalFileMutationViewModel,
  buildChangeListFileMutationViewModel,
  type FileMutationViewModel
} from "./file-mutation-view-model"

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

export interface LargeApprovalConfirmation {
  facts: LargeApprovalFact[]
  message: string | null
  title: string
  tone?: "default" | "warning" | "danger"
}

export interface LargeApprovalViewModel {
  action: LargeApprovalAction | null
  confirmation: LargeApprovalConfirmation | null
  fileMutation: FileMutationViewModel | null
  impact: LargeApprovalImpact[]
  parameters: LargeApprovalFact[]
  target: LargeApprovalFact[]
}

function getActionTitle(copy: AppCopy, approvalItem: ToolApprovalItem): string {
  return (
    copy.toolCall.labels[approvalItem.toolName] ||
    (approvalItem.kind === "extension_tool" ? approvalItem.toolTitle : null) ||
    approvalItem.toolName
  )
}

function buildExecuteLargeApprovalViewModel(
  copy: AppCopy,
  approvalItem: Extract<ToolApprovalItem, { kind: "execute_command" }>,
  toolCallId: string
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
    confirmation: null,
    fileMutation: buildChangeListFileMutationViewModel({
      changes: approvalItem.changes,
      source: "approval_preview",
      status: "pending",
      toolCallId
    }),
    impact: [
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
    target: []
  }
}

function buildFileMutationLargeApprovalViewModel(
  approvalItem: Extract<ToolApprovalItem, { kind: "file_mutation" }>,
  toolCallId: string
): LargeApprovalViewModel {
  return {
    action: null,
    confirmation: null,
    fileMutation: buildApprovalFileMutationViewModel(approvalItem, toolCallId),
    impact: [],
    parameters: [],
    target: []
  }
}

function buildExtensionLargeApprovalViewModel(
  copy: AppCopy,
  approvalItem: Extract<ToolApprovalItem, { kind: "extension_tool" }>
): LargeApprovalViewModel {
  const confirmationFacts: LargeApprovalFact[] =
    approvalItem.confirmation?.facts.map((fact) => ({
      label: fact.label,
      presentation: fact.mono ? ("mono" as const) : ("text" as const),
      value: fact.value
    })) ?? []
  const confirmation: LargeApprovalConfirmation | null = approvalItem.confirmation
    ? {
        facts: confirmationFacts,
        message: approvalItem.confirmation.message ?? null,
        title: approvalItem.confirmation.title,
        tone: approvalItem.confirmation.tone
      }
    : null
  const parameters: LargeApprovalFact[] = []

  if (!confirmation) {
    for (const [key, value] of Object.entries(approvalItem.args)) {
      if (key.startsWith("__")) {
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
  }

  return {
    action: confirmation
      ? null
      : {
          detail: approvalItem.toolName,
          presentation: "text",
          title: getActionTitle(copy, approvalItem)
        },
    confirmation,
    fileMutation: null,
    impact:
      confirmation || !approvalItem.reason
        ? []
        : [
            {
              detail: approvalItem.reason,
              label: copy.toolCall.approvalReason,
              tone: "warning" as const
            }
          ],
    parameters,
    target:
      confirmation || !approvalItem.capabilityDisplayName
        ? []
        : [
            {
              label: copy.toolCall.approvalSource,
              value: approvalItem.capabilityDisplayName
            }
          ]
  }
}

export function buildLargeApprovalViewModel(
  copy: AppCopy,
  approvalItem: ToolApprovalItem | null,
  rawArgs: string,
  toolCallId: string
): LargeApprovalViewModel {
  if (!approvalItem) {
    return {
      action: null,
      confirmation: null,
      fileMutation: null,
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
    return buildExecuteLargeApprovalViewModel(copy, approvalItem, toolCallId)
  }

  if (approvalItem.kind === "file_mutation") {
    return buildFileMutationLargeApprovalViewModel(approvalItem, toolCallId)
  }

  return buildExtensionLargeApprovalViewModel(copy, approvalItem)
}
