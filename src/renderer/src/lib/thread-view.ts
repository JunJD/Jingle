import type { ActiveAgentRun } from "@shared/agent-thread-runtime"
import type { HITLRequest } from "@shared/hitl"

export type ThreadActivityStatusView = "idle" | "interrupted" | "running"

export function projectThreadActivityStatus(input: {
  activeRun: ActiveAgentRun | null | undefined
  pendingApproval: HITLRequest | null | undefined
}): ThreadActivityStatusView {
  if (input.activeRun?.status === "running") {
    return "running"
  }

  if (input.pendingApproval) {
    return "interrupted"
  }

  return "idle"
}
