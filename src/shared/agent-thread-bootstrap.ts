import type { AgentThreadDataSnapshot } from "./app-types"
import type {
  ActiveAgentRun,
  AgentThreadRuntimeStatus
} from "./agent-thread-runtime"
import { deriveActiveRunFromMessages } from "./agent-run-bootstrap"
import type { IpcErrorPayload } from "./ipc-error"

export interface AgentThreadBootstrapState {
  activeRun: ActiveAgentRun | null
  error: IpcErrorPayload | null
  latestRunId: string | null
  pendingApproval: AgentThreadDataSnapshot["runState"]["pendingApproval"]
  status: AgentThreadRuntimeStatus
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
  const status: AgentThreadRuntimeStatus =
    threadData.thread.status === "busy"
      ? "running"
      : threadData.thread.status === "interrupted"
        ? "interrupted"
        : threadData.thread.status === "error"
          ? "error"
          : "idle"

  const activeRun =
    threadData.thread.status === "busy" || threadData.thread.status === "interrupted"
      ? deriveActiveRunFromMessages({
          latestRunId: threadData.runState.runId,
          messages: threadData.messages.messages,
          pendingApproval: threadData.runState.pendingApproval,
          threadId: threadData.thread.thread_id,
          threadStatus: threadData.thread.status
        })
      : null

  return {
    activeRun,
    error: toBootstrapError(threadData.runState.error),
    latestRunId: threadData.runState.runId,
    pendingApproval: threadData.runState.pendingApproval,
    status,
    todos: threadData.runState.todos
  }
}
