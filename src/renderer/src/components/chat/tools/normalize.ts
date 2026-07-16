import type { HITLRequest, ToolCall } from "@/types"
import type { FileMutationResultMetadata } from "@shared/file-mutation-result"
import { parseCompleteToolCallArgsObject } from "@shared/tool-call-args"
import { stringifyToolValue } from "./shared"
import type { RawToolProjectionFacts } from "./types"
import {
  buildApprovalFileMutationViewModel,
  buildCompletedFileMutationViewModel,
  buildRequiredFileMutationArgsProjection,
  buildStreamingFileMutationViewModel,
  type FileMutationProjection
} from "./file-mutation-view-model"

const EMPTY_ARGS: Record<string, unknown> = {}

interface ProjectToolProjectionFactsInput {
  activeArgsText?: string
  approvalRequest?: HITLRequest | null
  fileMutationResult?: FileMutationResultMetadata | null
  result?: unknown
  status: RawToolProjectionFacts["status"]
  toolCall: ToolCall
}

function buildFileMutationProjection(input: {
  activeArgsText?: string
  approvalRequest?: HITLRequest | null
  args: Record<string, unknown>
  fileMutationResult?: FileMutationResultMetadata | null
  status: RawToolProjectionFacts["status"]
  toolCall: ToolCall
}): FileMutationProjection | null {
  const { activeArgsText, approvalRequest, args, fileMutationResult, status, toolCall } = input

  if (status === "arguments_streaming") {
    return buildStreamingFileMutationViewModel({
      argsText: activeArgsText,
      toolCallId: toolCall.id,
      toolName: toolCall.name
    })
  }

  const argsProjection = buildRequiredFileMutationArgsProjection({
    args,
    toolName: toolCall.name
  })
  if (!argsProjection || argsProjection.kind === "invalid") {
    return argsProjection
  }

  if (approvalRequest?.review) {
    const viewModel = buildApprovalFileMutationViewModel(approvalRequest.review, toolCall.id)
    return viewModel ? { kind: "view", viewModel } : argsProjection
  }

  if (status === "complete") {
    return buildCompletedFileMutationViewModel({
      args,
      fileMutationResult,
      status,
      toolCallId: toolCall.id,
      toolName: toolCall.name
    })
  }

  return argsProjection
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

function resolveRawArgs(argsText: string | undefined, args: Record<string, unknown>): string {
  if (argsText !== undefined) {
    return argsText
  }

  return stringifyToolValue(args)
}

export function projectToolProjectionFacts(
  input: ProjectToolProjectionFactsInput
): RawToolProjectionFacts {
  const { activeArgsText, approvalRequest, fileMutationResult, result, status, toolCall } = input
  const activeArgs = resolveActiveToolArgs(activeArgsText)
  const args = resolveToolArgs(activeArgs, toolCall)
  const rawArgs = resolveRawArgs(activeArgsText, args)
  const rawResult = result === undefined ? "" : stringifyToolValue(result)
  const fileMutation = buildFileMutationProjection({
    activeArgsText,
    approvalRequest,
    args,
    fileMutationResult,
    status,
    toolCall
  })

  return {
    args,
    fileMutation,
    rawArgs,
    rawResult,
    result,
    status
  }
}
