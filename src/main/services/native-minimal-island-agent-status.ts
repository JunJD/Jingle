import type { AgentProjectionStatus } from "@shared/agent-projection"
import type { AgentStreamHub } from "../agent/stream-hub"
import { setNativeMinimalIslandState, type NativeMinimalIslandState } from "./native-minimal-island"

function resolveNativeMinimalIslandAgentState(
  statuses: Iterable<AgentProjectionStatus>
): NativeMinimalIslandState {
  let hasRunning = false

  for (const status of statuses) {
    if (status === "interrupted") {
      return "approval"
    }
    if (status === "running") {
      hasRunning = true
    }
  }

  return hasRunning ? "working" : "idle"
}

export function startNativeMinimalIslandAgentStatus(agentStreamHub: AgentStreamHub): () => void {
  const activeStatusesByThread = new Map<string, AgentProjectionStatus>()
  const stopListening = agentStreamHub.subscribeAll(
    "native-minimal-island-agent-status",
    (envelope) => {
      const { status, threadId } = envelope.projection

      if (status === "running" || status === "interrupted") {
        activeStatusesByThread.set(threadId, status)
      } else {
        activeStatusesByThread.delete(threadId)
      }

      setNativeMinimalIslandState(
        resolveNativeMinimalIslandAgentState(activeStatusesByThread.values())
      )
    }
  )

  return () => {
    stopListening()
    activeStatusesByThread.clear()
    setNativeMinimalIslandState("idle")
  }
}
