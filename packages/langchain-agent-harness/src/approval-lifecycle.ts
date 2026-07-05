import type { ActionRequest, ReviewConfig } from "langchain"
import type { RuntimeApproval } from "./runtime-state"

export type JingleApprovalDecisionType = "approve" | "reject"

export interface JingleApprovalToolCall {
  args: Record<string, unknown>
  id: string
  name: string
}

export interface JingleApprovalRequest<TReview = unknown> {
  allowed_decisions: JingleApprovalDecisionType[]
  id: string
  review: TReview | null
  tool_call: JingleApprovalToolCall
}

export interface JingleApprovalDecision {
  feedback?: string | null
  request_id: string
  tool_call_id?: string | null
  type: JingleApprovalDecisionType
}

interface ApprovalActionRequest extends ActionRequest {
  id?: string
  toolCallId: string
  description?: string
  review?: unknown
}

export interface JingleApprovalInterruptValue {
  actionRequests?: ApprovalActionRequest[]
  reviewConfigs?: ReviewConfig[]
}

export interface JingleApprovalInterrupt {
  value?: JingleApprovalInterruptValue
}

export type JingleApprovalReviewParser<TReview = unknown> = (value: unknown) => TReview | null

function isApprovalDecisionType(value: unknown): value is JingleApprovalDecisionType {
  return value === "approve" || value === "reject"
}

export function getDefaultJingleApprovalAllowedDecisions(): JingleApprovalDecisionType[] {
  return ["approve", "reject"]
}

export function normalizeJingleApprovalAllowedDecisions(
  value: unknown
): JingleApprovalDecisionType[] {
  if (!Array.isArray(value)) {
    return getDefaultJingleApprovalAllowedDecisions()
  }

  const decisions = value.filter(isApprovalDecisionType)
  return decisions.length > 0 ? decisions : getDefaultJingleApprovalAllowedDecisions()
}

function readRequiredApprovalToolCallId(action: ApprovalActionRequest | undefined): string {
  if (typeof action?.toolCallId === "string" && action.toolCallId.length > 0) {
    return action.toolCallId
  }

  throw new Error("[JingleApprovalLifecycle] Missing toolCallId for approval action.")
}

export function buildJingleApprovalRequestId(input: {
  requestContextId: string
  threadId: string
  toolCallId: string
}): string {
  return `hitl:${input.threadId}:${input.requestContextId}:${input.toolCallId}`
}

export function buildJinglePendingApprovalFact<TReview>(
  request: JingleApprovalRequest<TReview>
): RuntimeApproval {
  return {
    approvalId: request.id,
    requestId: request.id,
    status: "pending",
    toolCallId: request.tool_call.id
  }
}

export function buildJingleResolvedApprovalFact(
  decision: JingleApprovalDecision
): RuntimeApproval {
  const requestId = decision.request_id.trim()
  if (!requestId) {
    throw new Error("[JingleApprovalLifecycle] Missing approval request_id.")
  }

  return {
    approvalId: requestId,
    requestId,
    status: decision.type === "approve" ? "approved" : "rejected",
    toolCallId: decision.tool_call_id ?? null
  }
}

export function buildJingleApprovalRequestFromInterruptValue<TReview>(input: {
  interruptValue?: JingleApprovalInterruptValue
  parseReview: JingleApprovalReviewParser<TReview>
  requestContextId: string
  threadId: string
}): JingleApprovalRequest<TReview> | null {
  const action = input.interruptValue?.actionRequests?.[0]

  if (!action) {
    return null
  }

  const toolArgs = action.args || {}
  const toolCallId = readRequiredApprovalToolCallId(action)
  const requestId = buildJingleApprovalRequestId({
    requestContextId: input.requestContextId,
    threadId: input.threadId,
    toolCallId
  })
  const allowedDecisions = normalizeJingleApprovalAllowedDecisions(
    input.interruptValue?.reviewConfigs?.find((config) => config.actionName === action.name)
      ?.allowedDecisions
  )

  return {
    id: requestId,
    tool_call: {
      id: toolCallId,
      name: action.name,
      args: toolArgs
    },
    allowed_decisions: allowedDecisions,
    review: input.parseReview(action.review)
  }
}

export function projectJingleApprovalInterruptWithRequestId(input: {
  interrupts: readonly JingleApprovalInterrupt[]
  request: JingleApprovalRequest
}): JingleApprovalInterrupt[] {
  const firstInterrupt = input.interrupts[0]
  const firstAction = firstInterrupt?.value?.actionRequests?.[0]
  if (!firstInterrupt || !firstAction) {
    return [...input.interrupts]
  }

  return [
    {
      ...firstInterrupt,
      value: {
        ...firstInterrupt.value,
        actionRequests: [
          {
            ...firstAction,
            id: input.request.id,
            toolCallId: input.request.tool_call.id
          },
          ...(firstInterrupt.value?.actionRequests?.slice(1) ?? [])
        ]
      }
    },
    ...input.interrupts.slice(1)
  ]
}

export function projectJinglePendingApprovalRequestFromValues<TReview>(input: {
  data: unknown
  parseReview: JingleApprovalReviewParser<TReview>
  runId: string
  threadId: string
}): JingleApprovalRequest<TReview> | null {
  const state = input.data as { __interrupt__?: JingleApprovalInterrupt[] } | undefined
  const interruptValue = state?.__interrupt__?.[0]?.value

  return buildJingleApprovalRequestFromInterruptValue({
    interruptValue,
    parseReview: input.parseReview,
    requestContextId: input.runId,
    threadId: input.threadId
  })
}
