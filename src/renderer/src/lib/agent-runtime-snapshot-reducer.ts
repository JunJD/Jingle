import { isPermissionModeName, THREAD_PERMISSION_MODE_METADATA_KEY } from "@shared/permission-mode"
import { DEFAULT_MODELS } from "@shared/models"
import { DEFAULT_PERMISSION_MODE } from "@shared/permission-mode"
import type { AgentThreadDataSnapshot } from "@shared/app-types"
import type { IpcErrorPayload } from "@shared/ipc-error"
import { projectMessages } from "./message-projection"
import { stabilizeReferences } from "./stabilize-references"
import { stabilizeThreadMessages } from "./thread-message-stability"
import type { ThreadState } from "./thread-store-core"

function toRuntimeSnapshotStatus(
  status: AgentThreadDataSnapshot["thread"]["status"]
): ThreadState["agent"]["status"] {
  if (status === "error") {
    return "error"
  }

  return "idle"
}

function toSnapshotErrorPayload(error: string | null): IpcErrorPayload | null {
  if (!error) {
    return null
  }

  return {
    code: "INTERNAL",
    message: error,
    status: 500
  }
}

function isSnapshotMessageRollback(
  currentMessages: ThreadState["agent"]["messagesPage"],
  snapshotMessages: AgentThreadDataSnapshot["messages"]["messages"]
): boolean {
  if (currentMessages.length === 0 || snapshotMessages.length >= currentMessages.length) {
    return false
  }

  return snapshotMessages.every((message, index) => message.id === currentMessages[index]?.id)
}

export function applyRuntimeSnapshotToThreadState(
  state: ThreadState,
  snapshot: AgentThreadDataSnapshot
): ThreadState {
  const metadata = snapshot.thread.metadata || {}
  const hasRuntimeRun = state.agent.activeRun !== null
  const wouldRollbackRuntimeMessages =
    state.agent.revision > 0 &&
    isSnapshotMessageRollback(state.agent.messagesPage, snapshot.messages.messages)
  const canApplySnapshotContent =
    !hasRuntimeRun &&
    !wouldRollbackRuntimeMessages &&
    snapshot.thread.status !== "busy" &&
    snapshot.thread.status !== "interrupted"
  const messagesPage = canApplySnapshotContent
    ? stabilizeThreadMessages(state.agent.messagesPage, snapshot.messages.messages)
    : state.agent.messagesPage
  const permissionMode = metadata[THREAD_PERMISSION_MODE_METADATA_KEY]

  const artifacts = canApplySnapshotContent
    ? stabilizeReferences(state.agent.artifacts, snapshot.messages.artifacts)
    : state.agent.artifacts
  const forkState = canApplySnapshotContent
    ? stabilizeReferences(state.agent.forkState, snapshot.runState.forkState)
    : state.agent.forkState

  return {
    ...state,
    agent: {
      ...state.agent,
      activeRun: state.agent.activeRun,
      artifacts,
      currentModel: typeof metadata.model === "string" ? metadata.model : DEFAULT_MODELS.llm,
      error: canApplySnapshotContent
        ? toSnapshotErrorPayload(snapshot.runState.error)
        : state.agent.error,
      forkState,
      hasMoreBefore: false,
      messagesPage,
      pendingApproval: state.agent.pendingApproval,
      permissionMode: isPermissionModeName(permissionMode)
        ? permissionMode
        : DEFAULT_PERMISSION_MODE,
      latestRunId: state.agent.latestRunId,
      subagents: state.agent.subagents,
      status: canApplySnapshotContent
        ? toRuntimeSnapshotStatus(snapshot.thread.status)
        : state.agent.status,
      threadId: snapshot.thread.thread_id,
      todos: state.agent.todos,
      tokenUsage: state.agent.tokenUsage,
      workspacePath: snapshot.runState.workspacePath
    },
    view: {
      ...state.view,
      messageProjection: projectMessages(
        messagesPage,
        state.view.messageProjection,
        state.agent.activeRun
          ? {
              activeAssistantId: state.agent.activeRun.assistantMessageId,
              activeTurnKey: state.agent.activeRun.turnId
            }
          : {}
      )
    }
  }
}
