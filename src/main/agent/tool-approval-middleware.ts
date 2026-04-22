import { lstat } from "node:fs/promises"
import { ToolMessage } from "@langchain/core/messages"
import { interrupt } from "@langchain/langgraph"
import { createMiddleware } from "langchain"
import type { ActionRequest, DecisionType, ReviewConfig } from "langchain"
import { getDefaultHitlAllowedDecisions } from "@shared/hitl"
import { getExecuteCommandPolicy } from "@shared/execute-command-policy"
import type { MutationChangeType } from "@shared/mutation-prediction"
import { buildToolApprovalItem, type ToolApprovalItem } from "@shared/tool-approval"
import { getFileMutationReview, isFileMutationToolName } from "@shared/file-mutation-review"

const TOOL_APPROVAL_ALLOWED_DECISIONS = getDefaultHitlAllowedDecisions()

type ToolApprovalDecisionType = (typeof TOOL_APPROVAL_ALLOWED_DECISIONS)[number]

interface ToolApprovalDecision {
  feedback?: string
  type: ToolApprovalDecisionType
}

interface ToolApprovalResumeValue {
  decisions?: ToolApprovalDecision[]
}

interface ToolApprovalActionRequest extends ActionRequest {
  id: string
  review?: ToolApprovalItem | null
  toolCallId: string
}

interface ToolApprovalInterruptValue {
  kind: "tool-approval"
  actionRequests: ToolApprovalActionRequest[]
  reviewConfigs: ReviewConfig[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isToolApprovalDecisionType(value: DecisionType): value is ToolApprovalDecisionType {
  return value === "approve" || value === "reject"
}

function normalizeToolApprovalDecision(value: unknown): ToolApprovalDecision {
  const resumeValue = value as ToolApprovalResumeValue | undefined
  const decision = resumeValue?.decisions?.[0]

  if (!decision) {
    throw new Error("[ToolApprovalMiddleware] Missing approval decision.")
  }

  if (!isToolApprovalDecisionType(decision.type)) {
    throw new Error(
      `[ToolApprovalMiddleware] Unsupported approval decision: ${JSON.stringify(decision)}`
    )
  }

  return {
    feedback: decision.feedback,
    type: decision.type
  }
}

function buildRejectedToolMessage(input: {
  feedback?: string
  toolCallId: string
  toolName: string
}): ToolMessage {
  const { feedback, toolCallId, toolName } = input

  return new ToolMessage({
    content: feedback ?? `User rejected the ${toolName} tool call with id ${toolCallId}.`,
    name: toolName,
    tool_call_id: toolCallId,
    status: "error"
  })
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false
    }

    throw error
  }
}

export async function resolveFileMutationChangeType(
  toolName: string,
  args: Record<string, unknown>
): Promise<MutationChangeType | null> {
  const review = getFileMutationReview(toolName, args)
  if (!review?.path) {
    return null
  }

  if (review.toolName === "edit_file") {
    return "modify"
  }

  return (await pathExists(review.path)) ? "modify" : "create"
}

async function buildApprovalReview(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolApprovalItem | null> {
  const fileMutationChangeType = isFileMutationToolName(toolName)
    ? await resolveFileMutationChangeType(toolName, args)
    : undefined
  return buildToolApprovalItem(toolName, args, {
    fileMutationChangeType: fileMutationChangeType ?? undefined
  })
}

function buildApprovalDescription(toolName: string): string {
  return `Openwork approval required for ${toolName}.`
}

export function createToolApprovalMiddleware() {
  return createMiddleware({
    name: "ToolApprovalMiddleware",
    wrapToolCall: async (request, handler) => {
      const toolName = request.toolCall.name

      if (toolName === "execute") {
        if (!isRecord(request.toolCall.args)) {
          throw new Error("[ToolApprovalMiddleware] Execute tool call args must be an object.")
        }

        const toolArgs = request.toolCall.args
        const policy = getExecuteCommandPolicy(toolArgs)

        if (!policy) {
          throw new Error("[ToolApprovalMiddleware] Missing execute command policy metadata.")
        }

        if (policy.disposition === "allow") {
          return handler(request)
        }

        if (!request.toolCall.id) {
          throw new Error("[ToolApprovalMiddleware] Missing tool_call.id for execute tool call.")
        }

        if (policy.disposition === "deny") {
          return new ToolMessage({
            content: policy.reason,
            name: toolName,
            tool_call_id: request.toolCall.id,
            status: "error"
          })
        }
      } else if (!isFileMutationToolName(toolName)) {
        return handler(request)
      }

      if (!request.toolCall.id) {
        throw new Error(
          `[ToolApprovalMiddleware] Missing tool_call.id for ${request.toolCall.name} tool call.`
        )
      }

      const toolArgs = isRecord(request.toolCall.args) ? request.toolCall.args : {}
      const approvalReview = await buildApprovalReview(toolName, toolArgs)
      const resumeValue = (await interrupt({
        kind: "tool-approval",
        actionRequests: [
          {
            id: request.toolCall.id,
            toolCallId: request.toolCall.id,
            name: request.toolCall.name,
            args: toolArgs,
            description: buildApprovalDescription(toolName),
            review: approvalReview
          }
        ],
        reviewConfigs: [
          {
            actionName: request.toolCall.name,
            allowedDecisions: [...TOOL_APPROVAL_ALLOWED_DECISIONS]
          }
        ]
      } satisfies ToolApprovalInterruptValue)) as ToolApprovalResumeValue

      const decision = normalizeToolApprovalDecision(resumeValue)
      if (decision.type === "reject") {
        return buildRejectedToolMessage({
          feedback: decision.feedback,
          toolCallId: request.toolCall.id,
          toolName: request.toolCall.name
        })
      }

      return handler(request)
    }
  })
}
