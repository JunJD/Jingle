import { ToolMessage } from "@langchain/core/messages"
import { interrupt } from "@langchain/langgraph"
import { createMiddleware } from "langchain"
import type { ActionRequest, DecisionType, ReviewConfig } from "langchain"
import { getMutationPrediction } from "../../shared/mutation-prediction"

const EXECUTE_TOOL_NAME = "execute"
const EXECUTE_ALLOWED_DECISIONS = ["approve", "reject", "edit"] as const

interface ExecuteApprovalDecision {
  type: DecisionType
  editedArgs?: Record<string, unknown>
  feedback?: string
}

interface ExecuteApprovalResumeValue {
  decisions?: ExecuteApprovalDecision[]
}

interface ExecuteApprovalActionRequest extends ActionRequest {
  id: string
  toolCallId: string
}

interface ExecuteApprovalInterruptValue {
  kind: "execute-approval"
  actionRequests: ExecuteApprovalActionRequest[]
  reviewConfigs: ReviewConfig[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function buildExecuteApprovalDescription(args: Record<string, unknown>): string {
  const command = typeof args.command === "string" ? args.command : null
  const lines = ["Shell command approval required."]
  const prediction = getMutationPrediction(args)

  if (command) {
    lines.push("", `Command: ${command}`)
  } else {
    lines.push("", `Args: ${JSON.stringify(args, null, 2)}`)
  }

  if (prediction) {
    lines.push("", `Prediction: ${prediction.summary}`)

    if (prediction.changes.length > 0) {
      lines.push("", "Predicted files:")
      for (const change of prediction.changes.slice(0, 8)) {
        lines.push(`- ${change.changeType}: ${change.path}`)
      }

      if (prediction.changes.length > 8) {
        lines.push(`- +${prediction.changes.length - 8} more`)
      }
    }

    if (prediction.stderr) {
      lines.push("", `Simulator stderr: ${prediction.stderr}`)
    }
  }

  return lines.join("\n")
}

function normalizeExecuteDecision(value: unknown): ExecuteApprovalDecision {
  const resumeValue = value as ExecuteApprovalResumeValue | undefined
  const decision = resumeValue?.decisions?.[0]

  if (!decision) {
    throw new Error("[ExecuteApprovalMiddleware] Missing approval decision for execute tool call.")
  }

  if (!EXECUTE_ALLOWED_DECISIONS.includes(decision.type)) {
    throw new Error(
      `[ExecuteApprovalMiddleware] Unsupported approval decision: ${JSON.stringify(decision)}`
    )
  }

  return decision
}

function getEditedArgs(decision: ExecuteApprovalDecision): Record<string, unknown> {
  if (!isRecord(decision.editedArgs)) {
    throw new Error("[ExecuteApprovalMiddleware] Edit decision requires editedArgs.")
  }

  return decision.editedArgs
}

export function createExecuteApprovalMiddleware() {
  return createMiddleware({
    name: "ExecuteApprovalMiddleware",
    wrapToolCall: async (request, handler) => {
      if (request.toolCall.name !== EXECUTE_TOOL_NAME) {
        return handler(request)
      }

      if (!request.toolCall.id) {
        throw new Error("[ExecuteApprovalMiddleware] Missing tool_call.id for execute tool call.")
      }

      const toolArgs = isRecord(request.toolCall.args) ? request.toolCall.args : {}

      console.log("[ExecuteApprovalMiddleware] Intercepting execute tool call before execution", {
        toolCallId: request.toolCall.id,
        args: toolArgs
      })

      const resumeValue = (await interrupt({
        kind: "execute-approval",
        actionRequests: [
          {
            id: request.toolCall.id,
            toolCallId: request.toolCall.id,
            name: request.toolCall.name,
            args: toolArgs,
            description: buildExecuteApprovalDescription(toolArgs)
          }
        ],
        reviewConfigs: [
          {
            actionName: request.toolCall.name,
            allowedDecisions: [...EXECUTE_ALLOWED_DECISIONS]
          }
        ]
      } satisfies ExecuteApprovalInterruptValue)) as ExecuteApprovalResumeValue

      const decision = normalizeExecuteDecision(resumeValue)

      console.log("[ExecuteApprovalMiddleware] Received execute approval decision", {
        toolCallId: request.toolCall.id,
        decision: decision.type
      })

      if (decision.type === "reject") {
        return new ToolMessage({
          content:
            decision.feedback ??
            `User rejected the execute tool call with id ${request.toolCall.id}.`,
          name: request.toolCall.name,
          tool_call_id: request.toolCall.id,
          status: "error"
        })
      }

      const nextToolCall =
        decision.type === "edit"
          ? {
              ...request.toolCall,
              args: getEditedArgs(decision)
            }
          : request.toolCall

      return handler({
        ...request,
        toolCall: nextToolCall
      })
    }
  })
}
