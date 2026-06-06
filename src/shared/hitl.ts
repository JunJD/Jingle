import type { ToolCall as LangChainToolCall } from "@langchain/core/messages"
import type { ToolApprovalItem } from "./tool-approval"

export const DEFAULT_HITL_ALLOWED_DECISIONS = ["approve", "reject"] as const
export const HITL_DISPLAY_SIZE_NAMES = ["small", "large"] as const

export type HITLDecisionType = (typeof DEFAULT_HITL_ALLOWED_DECISIONS)[number]
export type HITLDisplaySize = (typeof HITL_DISPLAY_SIZE_NAMES)[number]

export interface HITLToolCall extends LangChainToolCall<string, Record<string, unknown>> {
  id: string
}

export interface HITLRequest {
  id: string
  tool_call: HITLToolCall
  allowed_decisions: HITLDecisionType[]
  review: ToolApprovalItem | null
}

export interface HITLDecision {
  type: HITLDecisionType
  request_id?: string
  tool_call_id?: string
  feedback?: string
}

function getRecordSize(value: Record<string, unknown>): number {
  return Object.keys(value).length
}

export function getToolApprovalDisplaySize(review: ToolApprovalItem | null): HITLDisplaySize {
  if (!review) {
    return "small"
  }

  if (review.kind === "file_mutation") {
    return "large"
  }

  if (review.kind === "execute_command") {
    return review.changes.length > 0 || review.profile === "unknown_command" ? "large" : "small"
  }

  if (review.kind === "extension_tool") {
    if (review.access !== "read") {
      return "large"
    }

    return getRecordSize(review.args) > 2 ? "large" : "small"
  }

  return "small"
}

export function getHitlRequestDisplaySize(request: HITLRequest): HITLDisplaySize {
  return getToolApprovalDisplaySize(request.review)
}

export function isHitlDecisionType(value: unknown): value is HITLDecisionType {
  return value === "approve" || value === "reject"
}

export function normalizeHitlAllowedDecisions(value: unknown): HITLDecisionType[] {
  if (!Array.isArray(value)) {
    return getDefaultHitlAllowedDecisions()
  }

  const decisions = value.filter(isHitlDecisionType)
  return decisions.length > 0 ? decisions : getDefaultHitlAllowedDecisions()
}

export function getDefaultHitlAllowedDecisions(): Array<
  (typeof DEFAULT_HITL_ALLOWED_DECISIONS)[number]
> {
  return [...DEFAULT_HITL_ALLOWED_DECISIONS]
}
