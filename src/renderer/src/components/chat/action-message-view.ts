import type { AppCopy } from "@/lib/i18n/messages"
import type { HITLRequest, ToolCall } from "@/types"
import { isExtensionToolCallPresentation } from "@shared/tool-presentation"
import {
  extensionToolComponent,
  getToolComponent,
  type ToolComponentDefinition,
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

const fallbackToolComponent: ToolComponentDefinition = {
  icon: extensionToolComponent.icon,
  name: "*",
  renderSummary({ copy, toolCall }) {
    return copy.toolCall.labels[toolCall.name] || toolCall.display?.title || toolCall.name
  }
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
  const definition =
    getToolComponent(toolCall.name) ??
    (isExtensionToolCallPresentation(toolCall.presentation)
      ? extensionToolComponent
      : fallbackToolComponent)
  const summary = definition.renderSummary({
    copy,
    isExpanded: Boolean(approvalRequest),
    presentation,
    toolCall,
    ...model
  })

  return {
    definition,
    icon: definition.icon,
    model,
    status: model.status,
    statusLabel: getToolStatusLabel(copy, model.status),
    summary
  }
}
