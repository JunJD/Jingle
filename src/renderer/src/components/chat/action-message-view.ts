import type { AppCopy } from "@/lib/i18n/messages"
import type { HITLRequest, ToolCall } from "@/types"
import type { ReactNode } from "react"
import { isExtensionToolCallPresentation } from "@shared/tool-presentation"
import {
  extensionToolComponent,
  getToolComponent,
  type ToolComponentDefinition,
  type ToolDisplay,
  type ToolComponentStatus,
  type ToolPresentation
} from "./tools"
import { normalizeToolRenderModel } from "./tools/normalize"

interface CreateActionMessageViewInput {
  approvalRequest?: HITLRequest | null
  copy: AppCopy
  presentation: ToolPresentation
  result?: unknown
  status?: ToolComponentStatus
  toolCall: ToolCall
}

export interface ActionMessageDisplay {
  detail: ReactNode | null
  resultMeta: ReactNode | null
  title: ReactNode
}

function normalizeActionMessageDisplay(display: ToolDisplay): ActionMessageDisplay {
  return {
    detail: display.detail ?? null,
    resultMeta: display.resultMeta ?? null,
    title: display.title
  }
}

export function getToolStatusLabel(copy: AppCopy, status: ToolComponentStatus): string | null {
  switch (status) {
    case "approval":
      return copy.common.approval
    case "arguments_streaming":
      return null
    case "running":
      return null
    case "waiting_result":
      return null
    case "complete":
      return null
    case "failed":
      return copy.common.error
  }
}

function getActionMessageToolComponent(toolCall: ToolCall): ToolComponentDefinition {
  const definition = getToolComponent(toolCall.name)
  if (definition) {
    return definition
  }

  if (isExtensionToolCallPresentation(toolCall.presentation)) {
    return extensionToolComponent
  }

  throw new Error(`No chat tool renderer registered for tool "${toolCall.name}".`)
}

export function createActionMessageView(input: CreateActionMessageViewInput) {
  const { approvalRequest, copy, presentation, result, status, toolCall } = input
  const model = normalizeToolRenderModel({
    approvalRequest,
    result,
    status,
    toolCall
  })
  const definition = getActionMessageToolComponent(toolCall)
  const display = normalizeActionMessageDisplay(definition.renderDisplay({
    copy,
    isExpanded: Boolean(approvalRequest),
    presentation,
    toolCall,
    ...model
  }))

  return {
    definition,
    display,
    icon: definition.icon,
    model,
    status: model.status,
    statusLabel: getToolStatusLabel(copy, model.status)
  }
}
