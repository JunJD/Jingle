import type { AppCopy } from "@/lib/i18n/messages"
import type { HITLRequest, ToolCall } from "@/types"
import type { ReactNode } from "react"
import { isExtensionToolCallPresentation } from "@shared/tool-presentation"
import type { FileMutationResultMetadata } from "@shared/file-mutation-result"
import {
  extensionToolComponent,
  getToolComponent,
  type ToolComponentDefinition,
  type ToolDisplay,
  type ToolComponentStatus,
  type ToolPresentation,
  type ToolRenderContext
} from "./tools"
import { projectToolProjectionFacts } from "./tools/normalize"
import { toolRendererCommands } from "./tools/tool-renderer-commands"

interface CreateActionMessageViewInput {
  activeArgsText?: string
  approvalRequest?: HITLRequest | null
  copy: AppCopy
  fileMutationResult?: FileMutationResultMetadata | null
  presentation: ToolPresentation
  result?: unknown
  status: ToolComponentStatus
  threadId: string
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
    case "unavailable":
      return copy.chat.messageContentUnavailable
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
  const {
    activeArgsText,
    approvalRequest,
    copy,
    fileMutationResult,
    result,
    status,
    threadId,
    toolCall
  } = input
  const facts = projectToolProjectionFacts({
    activeArgsText,
    approvalRequest,
    fileMutationResult,
    result,
    status,
    toolCall
  })
  const definition = getActionMessageToolComponent(toolCall)
  const component = definition.project({
    ...facts,
    threadId,
    toolCall
  })
  const renderContext: ToolRenderContext = {
    commands: toolRendererCommands,
    copy
  }
  const display = normalizeActionMessageDisplay(component.renderDisplay(renderContext))
  const hasDetail = component.hasDetail(renderContext)

  return {
    display,
    hasDetail,
    icon: definition.icon,
    renderDetail() {
      return component.renderDetail(renderContext)
    },
    status: facts.status,
    statusLabel: getToolStatusLabel(copy, facts.status)
  }
}
