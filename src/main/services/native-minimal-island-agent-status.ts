import type { AgentThreadRuntimeStatus } from "@shared/agent-thread-runtime"
import type { AgentStreamHub } from "../agent/stream-hub"
import { setNativeMinimalIslandState, type NativeMinimalIslandState } from "./native-minimal-island"

function resolveNativeMinimalIslandAgentState(
  statuses: Iterable<AgentThreadRuntimeStatus>
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
  const activeStatusesByThread = new Map<string, AgentThreadRuntimeStatus>()
  const stopListening = agentStreamHub.subscribeAllThreadEvents(
    "native-minimal-island-agent-status",
    (batch) => {
      let status: AgentThreadRuntimeStatus | null = null
      for (const event of batch.events) {
        if (event.type === "thread.snapshot" || event.type === "thread.statusChanged") {
          status = event.type === "thread.snapshot" ? event.snapshot.status : event.status
        }
        if (event.type === "run.started" || event.type === "run.resumed") {
          status = "running"
        }
        if (event.type === "approval.requested") {
          status = "interrupted"
        }
        if (event.type === "run.finished") {
          status =
            event.status === "failed"
              ? "error"
              : event.status === "cancelled"
                ? "cancelled"
                : "idle"
        }
      }

      if (!status) {
        return
      }

      if (status === "running" || status === "interrupted") {
        activeStatusesByThread.set(batch.threadId, status)
      } else {
        activeStatusesByThread.delete(batch.threadId)
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
