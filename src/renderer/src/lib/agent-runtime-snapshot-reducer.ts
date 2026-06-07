import { isPermissionModeName, THREAD_PERMISSION_MODE_METADATA_KEY } from "@shared/permission-mode"
import { DEFAULT_MODELS } from "@shared/models"
import { DEFAULT_PERMISSION_MODE } from "@shared/permission-mode"
import type { AgentThreadDataSnapshot } from "@shared/app-types"
import { projectMessages } from "./message-projection"
import { stabilizeReferences } from "./stabilize-references"
import { stabilizeThreadMessages } from "./thread-message-stability"
import type { ThreadState } from "./thread-store-core"

export function applyRuntimeSnapshotToThreadState(
  state: ThreadState,
  snapshot: AgentThreadDataSnapshot
): ThreadState {
  const metadata = snapshot.thread.metadata || {}
  const hasRuntimeRun = state.agent.activeRun !== null
  const canApplySnapshotContent =
    !hasRuntimeRun && snapshot.thread.status !== "busy" && snapshot.thread.status !== "interrupted"
  const messages = canApplySnapshotContent
    ? stabilizeThreadMessages(state.agent.messages, snapshot.messages.messages)
    : state.agent.messages
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
      error: canApplySnapshotContent ? snapshot.runState.error : state.agent.error,
      forkState,
      messages,
      pendingApproval: state.agent.pendingApproval,
      permissionMode: isPermissionModeName(permissionMode)
        ? permissionMode
        : DEFAULT_PERMISSION_MODE,
      runId: state.agent.runId,
      subagents: state.agent.subagents,
      todos: state.agent.todos,
      tokenUsage: state.agent.tokenUsage,
      workspacePath: typeof metadata.workspacePath === "string" ? metadata.workspacePath : null
    },
    view: {
      ...state.view,
      messageProjection: projectMessages(
        messages,
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
