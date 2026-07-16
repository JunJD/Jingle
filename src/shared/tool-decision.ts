export interface PolicyBlockedToolDecision {
  decisionId: string
  outcome: "policy_blocked"
  reason: string
  toolCallId: string
  toolName: string
}

export type ToolDecision = PolicyBlockedToolDecision

function invalidToolDecision(): never {
  throw new Error("Invalid Jingle tool decision fact.")
}

export function parseToolDecision(value: unknown): ToolDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidToolDecision()
  if (Object.getPrototypeOf(value) !== Object.prototype) return invalidToolDecision()
  const record = value as Record<string, unknown>
  const keys = Reflect.ownKeys(record)
  const expectedKeys = ["decisionId", "outcome", "reason", "toolCallId", "toolName"]
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) {
    return invalidToolDecision()
  }
  if (
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, key)
      return !descriptor || !("value" in descriptor)
    })
  ) {
    return invalidToolDecision()
  }
  if (
    record.outcome !== "policy_blocked" ||
    typeof record.decisionId !== "string" ||
    typeof record.reason !== "string" ||
    typeof record.toolCallId !== "string" ||
    typeof record.toolName !== "string"
  ) {
    return invalidToolDecision()
  }
  const decisionId = record.decisionId.trim()
  const reason = record.reason.trim()
  const toolCallId = record.toolCallId.trim()
  const toolName = record.toolName.trim()
  if (!decisionId || !reason || !toolCallId || !toolName) return invalidToolDecision()
  return {
    decisionId,
    outcome: "policy_blocked",
    reason,
    toolCallId,
    toolName
  }
}

export function parseOptionalToolDecision(value: unknown): ToolDecision | null {
  return value === undefined ? null : parseToolDecision(value)
}
