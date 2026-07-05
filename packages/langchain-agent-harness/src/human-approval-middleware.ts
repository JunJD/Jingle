import { ToolMessage } from "@langchain/core/messages"
import { interrupt, isGraphInterrupt, StateSchema } from "@langchain/langgraph"
import { createMiddleware } from "langchain"
import type { ActionRequest, ReviewConfig } from "langchain"
import type { RuntimeMiddlewareHook } from "./harness-runtime"
import { defineJingleHarnessHook } from "./harness-hooks"
import { runtimeApprovalsValue } from "./runtime-state"

export type HumanApprovalDisposition = "allow" | "deny" | "require_approval"
export type HumanApprovalDecisionType = "approve" | "reject"

export interface HumanApprovalDecision {
  feedback?: string
  type: HumanApprovalDecisionType
}

interface HumanApprovalResumeValue {
  decisions?: HumanApprovalDecision[]
}

interface HumanApprovalBatch {
  activeCount: number
  consumedDecision: boolean
}

export interface HumanApprovalPolicyRequest {
  args: unknown
  toolName: string
}

export interface HumanApprovalPolicyDecision<TReview = unknown> {
  args: Record<string, unknown>
  disposition: HumanApprovalDisposition
  reason?: string
  review?: TReview | null
}

export interface HumanApprovalPolicyRuntime<TReview = unknown> {
  evaluate(
    request: HumanApprovalPolicyRequest
  ): Promise<HumanApprovalPolicyDecision<TReview>> | HumanApprovalPolicyDecision<TReview>
}

export type HumanApprovalRequester<TReview = unknown> = (input: {
  review?: TReview | null
  toolArgs: Record<string, unknown>
  toolCallId: string
  toolName: string
}) => Promise<HumanApprovalDecision>

interface HumanApprovalActionRequest<TReview = unknown> extends ActionRequest {
  review?: TReview | null
  toolCallId: string
}

interface HumanApprovalInterruptValue<TReview = unknown> {
  kind: "tool-approval"
  actionRequests: HumanApprovalActionRequest<TReview>[]
  reviewConfigs: ReviewConfig[]
}

const humanApprovalStateSchema = new StateSchema({
  approvals: runtimeApprovalsValue
})

export interface CreateHumanApprovalMiddlewareOptions<TReview = unknown> {
  allowedDecisions: readonly HumanApprovalDecisionType[]
  middlewareName?: string
  policyRuntime: HumanApprovalPolicyRuntime<TReview>
  requestApproval?: HumanApprovalRequester<TReview>
}

function isAllowedDecisionType(
  value: unknown,
  allowedDecisions: readonly HumanApprovalDecisionType[]
): value is HumanApprovalDecisionType {
  return typeof value === "string" && allowedDecisions.includes(value as HumanApprovalDecisionType)
}

function normalizeHumanApprovalDecision(
  value: unknown,
  allowedDecisions: readonly HumanApprovalDecisionType[]
): HumanApprovalDecision {
  const resumeValue = value as HumanApprovalResumeValue | undefined
  const decision = resumeValue?.decisions?.[0]

  if (!decision) {
    throw new Error("[HumanApprovalMiddleware] Missing approval decision.")
  }

  if (!isAllowedDecisionType(decision.type, allowedDecisions)) {
    throw new Error(
      `[HumanApprovalMiddleware] Unsupported approval decision: ${JSON.stringify(decision)}`
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
  const normalizedFeedback = typeof feedback === "string" ? feedback.trim() : ""

  return new ToolMessage({
    content: normalizedFeedback
      ? `User rejected the ${toolName} tool call with id ${toolCallId}. Feedback: ${normalizedFeedback}`
      : `User rejected the ${toolName} tool call with id ${toolCallId}.`,
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
      "Jingle skipped this concurrent approval-required tool call because only one approval-required action can be evaluated per assistant step.",
    name: toolName,
    tool_call_id: toolCallId,
    status: "error"
  })
}

function buildApprovalDescription(toolName: string): string {
  return `Jingle approval required for ${toolName}.`
}

function createDefaultApprovalRequester<TReview>(
  allowedDecisions: readonly HumanApprovalDecisionType[]
): HumanApprovalRequester<TReview> {
  return async (input) => {
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
          allowedDecisions: [...allowedDecisions]
        }
      ]
    } satisfies HumanApprovalInterruptValue<TReview>)) as HumanApprovalResumeValue

    return normalizeHumanApprovalDecision(resumeValue, allowedDecisions)
  }
}

function createHumanApprovalRuntimeMiddleware<TReview = unknown>(
  options: CreateHumanApprovalMiddlewareOptions<TReview>
) {
  const middlewareName = options.middlewareName ?? "HumanApprovalMiddleware"
  const approvalRequester =
    options.requestApproval ?? createDefaultApprovalRequester<TReview>(options.allowedDecisions)
  let approvalGate: Promise<void> = Promise.resolve()
  let approvalBatch: HumanApprovalBatch | null = null

  async function runWithApprovalGate<T>(operation: () => Promise<T>): Promise<T> {
    let batch = approvalBatch
    if (!batch) {
      batch = {
        activeCount: 0,
        consumedDecision: false
      }
      approvalBatch = batch
    }
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
    name: middlewareName,
    stateSchema: humanApprovalStateSchema,
    wrapToolCall: async (request, handler) => {
      const toolName = request.toolCall.name
      const decision = await options.policyRuntime.evaluate({
        args: request.toolCall.args,
        toolName
      })

      if (decision.disposition === "allow") {
        return handler(request)
      }

      if (!request.toolCall.id) {
        throw new Error(
          `[${middlewareName}] Missing tool_call.id for ${request.toolCall.name} tool call.`
        )
      }
      const toolCallId = request.toolCall.id

      if (decision.disposition === "deny") {
        return buildErroredToolMessage({
          content: decision.reason ?? `Jingle denied ${toolName}.`,
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

export function createJingleHumanApprovalHook<TReview = unknown>(
  options: CreateHumanApprovalMiddlewareOptions<TReview>
): RuntimeMiddlewareHook {
  return defineJingleHarnessHook({
    name: "approvals",
    phase: "agent_loop",
    adapterStateKeys: ["__interrupt__"],
    reads: [],
    runtimeStateKeys: [],
    writes: ["approvals"],
    writePolicy: "host-port",
    failureSemantics: "core",
    observableSignals: ["state", "stream", "recording"],
    createMiddleware: () => createHumanApprovalRuntimeMiddleware(options)
  })
}
