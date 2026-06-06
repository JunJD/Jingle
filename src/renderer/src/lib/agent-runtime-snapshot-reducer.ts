import { isPermissionModeName, THREAD_PERMISSION_MODE_METADATA_KEY } from "@shared/permission-mode"
import type { AgentThreadDataSnapshot } from "@shared/app-types"
import { deriveThreadBootstrapState } from "@shared/agent-thread-bootstrap"
import { projectMessages } from "./message-projection"
import { stabilizeReferences } from "./stabilize-references"
import { stabilizeThreadMessages } from "./thread-message-stability"
import type { ThreadState } from "./thread-store-core"

export function applyRuntimeSnapshotToThreadState(
  state: ThreadState,
  snapshot: AgentThreadDataSnapshot
): ThreadState {
  const metadata = snapshot.thread.metadata || {}
  const hasActiveRuntimeRun = state.agent.activeRun?.status === "running"
  const messages = hasActiveRuntimeRun
    ? state.agent.messages
    : stabilizeThreadMessages(state.agent.messages, snapshot.messages.messages)
  const permissionMode = metadata[THREAD_PERMISSION_MODE_METADATA_KEY]
  const bootstrap = deriveThreadBootstrapState({
    ...snapshot,
    messages: {
      ...snapshot.messages,
      messages
    }
  })

  const nextActiveRun = hasActiveRuntimeRun
    ? state.agent.activeRun
    : snapshot.thread.status === "busy"
      ? (state.agent.activeRun ?? bootstrap.activeRun)
      : bootstrap.activeRun
  const activeRun = stabilizeReferences(state.agent.activeRun, nextActiveRun)
  const artifacts = stabilizeReferences(state.agent.artifacts, snapshot.messages.artifacts)
  const forkState = stabilizeReferences(state.agent.forkState, snapshot.runState.forkState)
  const pendingApproval = hasActiveRuntimeRun
    ? state.agent.pendingApproval
    : stabilizeReferences(state.agent.pendingApproval, bootstrap.pendingApproval)
  const subagents =
    snapshot.thread.status === "busy" || hasActiveRuntimeRun
      ? state.agent.subagents
      : stabilizeReferences(state.agent.subagents, [])
  const todos = hasActiveRuntimeRun
    ? state.agent.todos
    : stabilizeReferences(state.agent.todos, bootstrap.todos)
  const activeProjectionInput = activeRun
    ? {
        activeAssistantId: activeRun.assistantMessageId,
        activeTurnKey: activeRun.turnId
      }
    : {}

  return {
    ...state,
    agent: {
      ...state.agent,
      activeRun,
      artifacts,
      currentModel: typeof metadata.model === "string" ? metadata.model : state.agent.currentModel,
      error: hasActiveRuntimeRun ? state.agent.error : (bootstrap.error?.message ?? null),
      forkState,
      messages,
      pendingApproval,
      permissionMode: isPermissionModeName(permissionMode)
        ? permissionMode
        : state.agent.permissionMode,
      runId: hasActiveRuntimeRun ? state.agent.runId : bootstrap.latestRunId,
      subagents,
      title: snapshot.thread.title ?? state.agent.title,
      todos,
      tokenUsage:
        snapshot.thread.status === "busy" || hasActiveRuntimeRun ? state.agent.tokenUsage : null,
      workspacePath:
        typeof metadata.workspacePath === "string"
          ? metadata.workspacePath
          : state.agent.workspacePath
    },
    view: {
      ...state.view,
      messageProjection: projectMessages(
        messages,
        state.view.messageProjection,
        activeProjectionInput
      )
    }
  }
}
