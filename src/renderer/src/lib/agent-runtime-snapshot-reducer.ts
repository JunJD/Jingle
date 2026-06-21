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
  if (currentMessages.length === 0) {
    return false
  }

  const snapshotMessageEntries = snapshotMessages.map(
    (message, index) => [message.id, { index, message }] as const
  )
  const snapshotMessagesById = new Map(snapshotMessageEntries)
  let lastSnapshotIndex = -1

  return currentMessages.some((currentMessage) => {
    const snapshotEntry = snapshotMessagesById.get(currentMessage.id)
    if (!snapshotEntry || snapshotEntry.index < lastSnapshotIndex) {
      return true
    }

    lastSnapshotIndex = snapshotEntry.index
    const snapshotMessage = snapshotEntry.message

    return (
      typeof currentMessage.content === "string" &&
      typeof snapshotMessage.content === "string" &&
      currentMessage.content.startsWith(snapshotMessage.content) &&
      snapshotMessage.content.length < currentMessage.content.length
    )
  })
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
  const isLiveSnapshot = snapshot.thread.status === "busy" || snapshot.thread.status === "interrupted"
  const canApplySnapshotContent = !hasRuntimeRun && !wouldRollbackRuntimeMessages && !isLiveSnapshot
  const canApplySnapshotRuntimeState =
    !hasRuntimeRun && !wouldRollbackRuntimeMessages && !isLiveSnapshot
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
  const contextInclusions = canApplySnapshotRuntimeState
    ? stabilizeReferences(state.agent.contextInclusions, snapshot.runState.contextInclusions)
    : state.agent.contextInclusions

  return {
    ...state,
    agent: {
      ...state.agent,
      activeRun: state.agent.activeRun,
      artifacts,
      contextInclusions,
      currentModel: typeof metadata.model === "string" ? metadata.model : DEFAULT_MODELS.llm,
      error: canApplySnapshotRuntimeState
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
      status: canApplySnapshotRuntimeState
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
