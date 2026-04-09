import type { ToolCall as LangChainToolCall } from "@langchain/core/messages"
import type { ToolApprovalItem } from "./tool-approval"

export const DEFAULT_HITL_ALLOWED_DECISIONS = ["approve", "reject"] as const

export type HITLDecisionType = (typeof DEFAULT_HITL_ALLOWED_DECISIONS)[number]

export interface HITLToolCall extends LangChainToolCall<string, Record<string, unknown>> {
  id?: string
}

export interface HITLRequest {
  id: string
  tool_call: HITLToolCall
  allowed_decisions: HITLDecisionType[]
  review: ToolApprovalItem | null
}

export interface HITLDecision {
  type: HITLDecisionType
  tool_call_id?: string
  feedback?: string
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
