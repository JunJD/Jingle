import { ToolMessage } from "@langchain/core/messages"
import { interrupt, isGraphInterrupt } from "@langchain/langgraph"
import { createMiddleware } from "langchain"
import type { ActionRequest, DecisionType, ReviewConfig } from "langchain"
import { getDefaultHitlAllowedDecisions } from "@shared/hitl"
import type { PermissionModeName } from "@shared/permission-mode"
import type { ToolApprovalItem } from "@shared/tool-approval"
import { getAgentConfig } from "../preferences"
import type { AgentConfig } from "../types"
import type { ExtensionToolApprovalPolicyProvider } from "../extension-tools/permission"
import {
  createToolPermissionRuntime,
  resolveFileMutationChangeType,
  type ToolPermissionRuntime
} from "./tool-permission-runtime"

const TOOL_APPROVAL_ALLOWED_DECISIONS = getDefaultHitlAllowedDecisions()

export { resolveFileMutationChangeType }

type ToolApprovalDecisionType = (typeof TOOL_APPROVAL_ALLOWED_DECISIONS)[number]

interface ToolApprovalDecision {
  feedback?: string
  type: ToolApprovalDecisionType
}

interface ToolApprovalResumeValue {
  decisions?: ToolApprovalDecision[]
}

interface ApprovalBatch {
  activeCount: number
  consumedDecision: boolean
}

type ToolApprovalRequester = (input: {
  review?: ToolApprovalItem | null
  toolArgs: Record<string, unknown>
  toolCallId: string
  toolName: string
}) => Promise<ToolApprovalDecision>

interface ToolApprovalActionRequest extends ActionRequest {
  review?: ToolApprovalItem | null
  toolCallId: string
}

interface ToolApprovalInterruptValue {
  kind: "tool-approval"
  actionRequests: ToolApprovalActionRequest[]
  reviewConfigs: ReviewConfig[]
}

interface CreateToolApprovalMiddlewareOptions {
  extensionToolPolicyProvider?: ExtensionToolApprovalPolicyProvider
  getAgentConfig?: () => AgentConfig
  permissionMode?: PermissionModeName
  permissionRuntime?: ToolPermissionRuntime
  requestToolApproval?: ToolApprovalRequester
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

function buildErroredToolMessage(input: {
  content: string
  toolCallId: string
  toolName: string
}): ToolMessage {
  const { content, toolCallId, toolName } = input

  return new ToolMessage({
    content,
    name: toolName,
    tool_call_id: toolCallId,
    status: "error"
  })
}

function buildDeferredToolMessage(input: { toolCallId: string; toolName: string }): ToolMessage {
  const { toolCallId, toolName } = input

  return new ToolMessage({
    content:
      "Openwork skipped this concurrent approval-required tool call because only one approval-required action can be evaluated per assistant step.",
    name: toolName,
    tool_call_id: toolCallId,
    status: "error"
  })
}

function buildApprovalDescription(toolName: string): string {
  return `Openwork approval required for ${toolName}.`
}

async function requestToolApproval(input: {
  review?: ToolApprovalItem | null
  toolArgs: Record<string, unknown>
  toolCallId: string
  toolName: string
}): Promise<ToolApprovalDecision> {
  const resumeValue = (await interrupt({
    kind: "tool-approval",
    actionRequests: [
      {
        toolCallId: input.toolCallId,
        name: input.toolName,
        args: input.toolArgs,
        description: buildApprovalDescription(input.toolName),
        review: input.review ?? null
      }
    ],
    reviewConfigs: [
      {
        actionName: input.toolName,
        allowedDecisions: [...TOOL_APPROVAL_ALLOWED_DECISIONS]
      }
    ]
  } satisfies ToolApprovalInterruptValue)) as ToolApprovalResumeValue

  return normalizeToolApprovalDecision(resumeValue)
}

export function createToolApprovalMiddleware(options: CreateToolApprovalMiddlewareOptions = {}) {
  const permissionRuntime =
    options.permissionRuntime ??
    createToolPermissionRuntime({
      extensionToolPolicyProvider: options.extensionToolPolicyProvider,
      getAgentConfig: options.getAgentConfig ?? getAgentConfig,
      permissionMode: options.permissionMode
    })
  const approvalRequester = options.requestToolApproval ?? requestToolApproval
  let approvalGate: Promise<void> = Promise.resolve()
  let approvalBatch: ApprovalBatch | null = null

  async function runWithApprovalGate<T>(operation: () => Promise<T>): Promise<T> {
    const batch =
      approvalBatch ??
      {
        activeCount: 0,
        consumedDecision: false
      }
    approvalBatch = batch
    batch.activeCount += 1
    const previousGate = approvalGate
    let releaseGate!: () => void
    approvalGate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    await previousGate

    try {
      const result = await operation()
      batch.consumedDecision = true
      releaseGate()
      return result
    } catch (error) {
      if (!isGraphInterrupt(error)) {
        releaseGate()
      }
      throw error
    } finally {
      batch.activeCount -= 1
      if (batch.activeCount === 0 && approvalBatch === batch) {
        approvalBatch = null
      }
    }
  }

  return createMiddleware({
    name: "ToolApprovalMiddleware",
    wrapToolCall: async (request, handler) => {
      const toolName = request.toolCall.name
      const decision = await permissionRuntime.evaluate({
        args: request.toolCall.args,
        toolName
      })

      if (decision.disposition === "allow") {
        return handler(request)
      }

      if (!request.toolCall.id) {
        throw new Error(
          `[ToolApprovalMiddleware] Missing tool_call.id for ${request.toolCall.name} tool call.`
        )
      }
      const toolCallId = request.toolCall.id

      if (decision.disposition === "deny") {
        return buildErroredToolMessage({
          content: decision.reason ?? `Openwork denied ${toolName}.`,
          toolCallId,
          toolName
        })
      }

      return runWithApprovalGate(async () => {
        if (approvalBatch?.consumedDecision) {
          return buildDeferredToolMessage({
            toolCallId,
            toolName: request.toolCall.name
          })
        }

        const approvalDecision = await approvalRequester({
          review: decision.review,
          toolArgs: decision.args,
          toolCallId,
          toolName: request.toolCall.name
        })
        if (approvalDecision.type === "reject") {
          return buildRejectedToolMessage({
            feedback: approvalDecision.feedback,
            toolCallId,
            toolName: request.toolCall.name
          })
        }

        return handler(request)
      })
    }
  })
}
