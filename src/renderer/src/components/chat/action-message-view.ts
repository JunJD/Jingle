import type { AppCopy } from "@/lib/i18n/messages"
import type { HITLRequest, ToolCall } from "@/types"
import {
  defaultHumanInTheLoop,
  defaultToolComponent,
  getHumanInTheLoop,
  getToolComponent,
  type ToolComponentStatus,
  type ToolPresentation
} from "./tools"
import { normalizeToolRenderModel } from "./tools/normalize"

interface CreateActionMessageViewInput {
  approvalRequest?: HITLRequest | null
  copy: AppCopy
  presentation: ToolPresentation
  result?: unknown
  toolCall: ToolCall
}

export function getToolStatusLabel(copy: AppCopy, status: ToolComponentStatus): string | null {
  switch (status) {
    case "approval":
      return copy.common.approval
    case "running":
      return null
    case "complete":
      return null
  }
}

export function createActionMessageView(input: CreateActionMessageViewInput) {
  const { approvalRequest, copy, presentation, result, toolCall } = input
  const model = normalizeToolRenderModel({
    approvalRequest,
    result,
    toolCall
  })
  const definition = getToolComponent(toolCall.name) || defaultToolComponent
  const hitlDefinition = approvalRequest
    ? getHumanInTheLoop(toolCall.name) || defaultHumanInTheLoop
    : null
  const summary = definition.renderSummary({
    copy,
    isExpanded: Boolean(approvalRequest),
    presentation,
    toolCall,
    ...model
  })

  return {
    definition,
    hitlDefinition,
    icon: hitlDefinition?.icon ?? definition.icon,
    model,
    status: model.status,
    statusLabel: getToolStatusLabel(copy, model.status),
    summary
  }
}
