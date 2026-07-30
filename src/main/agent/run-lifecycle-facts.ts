import { parseAgentEventPayloadFromJson } from "../agent-events/schema"

export function isDurableTerminalRunFinishedPayload(payloadJson: string): boolean {
  const payload = parseAgentEventPayloadFromJson("run.finished", payloadJson)
  return payload.status !== "interrupted" || payload.completionReason === "aborted"
}
