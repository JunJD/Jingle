import type { JingleRuntimeStatus } from "@jingle/agent-client"
import type { AgentThreadRunner } from "../agent/agent-thread-runner"
import { setNativeMinimalIslandState, type NativeMinimalIslandState } from "./native-minimal-island"

function resolveNativeMinimalIslandAgentState(
  statuses: Iterable<JingleRuntimeStatus>
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

export function startNativeMinimalIslandAgentStatus(
  agentThreadRunner: AgentThreadRunner
): () => void {
  const activeStatusesByThread = new Map<string, JingleRuntimeStatus>()
  const stopListening = agentThreadRunner.connectAllThreadEvents(
    "native-minimal-island-agent-status",
    (batch) => {
      let status: JingleRuntimeStatus | null = null
      for (const event of batch.events) {
        if (event.type === "thread.statusChanged") {
          status = event.status
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
