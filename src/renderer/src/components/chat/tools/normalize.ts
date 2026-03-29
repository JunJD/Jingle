import type { HITLRequest, ToolCall } from "@/types"
import { stringifyToolValue } from "./shared"
import type { ToolRenderModel } from "./types"

const EMPTY_ARGS: Record<string, unknown> = {}

interface NormalizeToolRenderModelInput {
  approvalRequest?: HITLRequest | null
  result?: unknown
  toolCall: ToolCall
}

export function normalizeToolRenderModel(input: NormalizeToolRenderModelInput): ToolRenderModel {
  const { approvalRequest, result, toolCall } = input
  const args = toolCall.args ?? EMPTY_ARGS
  const status = approvalRequest ? "approval" : result === undefined ? "running" : "complete"

  const rawArgs = stringifyToolValue(args)
  const rawResult = result === undefined ? "" : stringifyToolValue(result)

  return {
    args,
    hasResult: result !== undefined,
    rawArgs,
    rawResult,
    result,
    status
  }
}
