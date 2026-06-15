import type { HITLRequest, ToolCall } from "@/types"
import type { FileMutationResultMetadata } from "@shared/file-mutation-result"
import { parseCompleteToolCallArgsObject } from "@shared/tool-call-args"
import { stringifyToolValue } from "./shared"
import type { ToolRenderModel } from "./types"
import {
  buildApprovalFileMutationViewModel,
  buildCompletedFileMutationViewModel,
  buildStreamingFileMutationViewModel,
  type FileMutationProjection
} from "./file-mutation-view-model"

const EMPTY_ARGS: Record<string, unknown> = {}

interface NormalizeToolRenderModelInput {
  activeArgsText?: string
  approvalRequest?: HITLRequest | null
  fileMutationResult?: FileMutationResultMetadata | null
  result?: unknown
  status?: ToolRenderModel["status"]
  toolCall: ToolCall
}

function buildFileMutationProjection(input: {
  activeArgsText?: string
  approvalRequest?: HITLRequest | null
  fileMutationResult?: FileMutationResultMetadata | null
  result?: unknown
  status: ToolRenderModel["status"]
  toolCall: ToolCall
}): FileMutationProjection | null {
  const { activeArgsText, approvalRequest, fileMutationResult, result, status, toolCall } = input

  if (approvalRequest?.review) {
    const viewModel = buildApprovalFileMutationViewModel(approvalRequest.review, toolCall.id)
    return viewModel ? { kind: "view", viewModel } : null
  }

  if (status === "arguments_streaming") {
    return buildStreamingFileMutationViewModel({
      argsText: activeArgsText,
      toolCallId: toolCall.id,
      toolName: toolCall.name
    })
  }

  if (status === "complete") {
    return buildCompletedFileMutationViewModel({
      fileMutationResult,
      result,
      status,
      toolCallId: toolCall.id,
      toolName: toolCall.name
    })
  }

  return null
}

function resolveActiveToolArgs(argsText: string | undefined): Record<string, unknown> | null {
  if (argsText === undefined) {
    return null
  }

  return parseCompleteToolCallArgsObject(argsText)
}

function resolveToolArgs(
  activeArgs: Record<string, unknown> | null,
  toolCall: ToolCall
): Record<string, unknown> {
  if (activeArgs) {
    return activeArgs
  }

  if (toolCall.args) {
    return toolCall.args
  }

  return EMPTY_ARGS
}

function resolveToolStatus(
  approvalRequest: HITLRequest | null | undefined,
  explicitStatus: ToolRenderModel["status"] | undefined
): ToolRenderModel["status"] {
  if (approvalRequest) {
    return "approval"
  }

  if (explicitStatus) {
    return explicitStatus
  }

  return "complete"
}

function resolveRawArgs(argsText: string | undefined, args: Record<string, unknown>): string {
  if (argsText !== undefined) {
    return argsText
  }

  return stringifyToolValue(args)
}

export function normalizeToolRenderModel(input: NormalizeToolRenderModelInput): ToolRenderModel {
  const {
    activeArgsText,
    approvalRequest,
    fileMutationResult,
    result,
    status: explicitStatus,
    toolCall
  } = input
  const activeArgs = resolveActiveToolArgs(activeArgsText)
  const args = resolveToolArgs(activeArgs, toolCall)
  const status = resolveToolStatus(approvalRequest, explicitStatus)

  const rawArgs = resolveRawArgs(activeArgsText, args)
  const rawResult = result === undefined ? "" : stringifyToolValue(result)
  const fileMutation = buildFileMutationProjection({
    activeArgsText,
    approvalRequest,
    fileMutationResult,
    result,
    status,
    toolCall
  })

  return {
    args,
    fileMutation,
    hasResult: result !== undefined,
    rawArgs,
    rawResult,
    result,
    status
  }
}
