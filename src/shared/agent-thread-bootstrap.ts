import type { AgentThreadDataSnapshot } from "./app-types"
import type { IpcErrorPayload } from "./ipc-error"
import type { JingleRuntimeStatus } from "@jingle/agent-client"
import { deriveJingleActiveRunFromMessages, type JingleActiveAgentRun } from "@jingle/agent-client"

export interface AgentThreadBootstrapState {
  activeRun: JingleActiveAgentRun | null
  contextInclusions: AgentThreadDataSnapshot["runState"]["contextInclusions"]
  error: IpcErrorPayload | null
  latestRunId: string | null
  pendingApproval: AgentThreadDataSnapshot["runState"]["pendingApproval"]
  status: JingleRuntimeStatus
  todos: AgentThreadDataSnapshot["runState"]["todos"]
}

function toBootstrapError(error: string | null): IpcErrorPayload | null {
  if (error === null) {
    return null
  }

  return {
    code: "INTERNAL",
    message: error,
    status: 500
  }
}

export function deriveThreadBootstrapState(
  threadData: AgentThreadDataSnapshot
): AgentThreadBootstrapState {
  const status: JingleRuntimeStatus =
    threadData.thread.status === "busy"
      ? "running"
      : threadData.thread.status === "interrupted"
        ? "interrupted"
        : threadData.thread.status === "error"
          ? "error"
          : "idle"

  const activeRun =
    threadData.thread.status === "busy" || threadData.thread.status === "interrupted"
      ? deriveJingleActiveRunFromMessages({
          latestRunId: threadData.runState.runId,
          messages: threadData.messages.messages,
          pendingApproval: threadData.runState.pendingApproval,
          threadId: threadData.thread.thread_id,
          threadStatus: threadData.thread.status
        })
      : null

  return {
    activeRun,
    contextInclusions: threadData.runState.contextInclusions,
    error: toBootstrapError(threadData.runState.error),
    latestRunId: threadData.runState.runId,
    pendingApproval: threadData.runState.pendingApproval,
    status,
    todos: threadData.runState.todos
  }
}
