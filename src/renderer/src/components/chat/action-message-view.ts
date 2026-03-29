import type { AppCopy } from "@/lib/i18n/messages"
import type { HITLRequest, ToolCall } from "@/types"
import {
  defaultHumanInTheLoop,
  defaultToolComponent,
  getHumanInTheLoop,
  getToolComponent,
  type ToolPresentation
} from "./tools"
import { normalizeToolRenderModel } from "./tools/normalize"

interface CreateActionMessageViewInput {
  approvalRequest?: HITLRequest | null
  copy: AppCopy
  isError?: boolean
  presentation: ToolPresentation
  result?: unknown
  toolCall: ToolCall
}

export function createActionMessageView(input: CreateActionMessageViewInput) {
  const { approvalRequest, copy, isError, presentation, result, toolCall } = input
  const model = normalizeToolRenderModel({
    approvalRequest,
    isError,
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
    summary
  }
}
