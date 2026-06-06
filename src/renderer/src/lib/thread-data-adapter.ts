import { isPermissionModeName, THREAD_PERMISSION_MODE_METADATA_KEY } from "@shared/permission-mode"
import type { AgentThreadDataSnapshot } from "@shared/app-types"
import { deriveThreadBootstrapState } from "@shared/agent-thread-bootstrap"
import { projectMessages } from "./message-projection"
import { stabilizeThreadMessages } from "./thread-message-stability"
import type { ThreadState } from "./thread-store-core"

export function applyThreadDataSnapshotToThreadState(
  state: ThreadState,
  snapshot: AgentThreadDataSnapshot
): ThreadState {
  const metadata = snapshot.thread.metadata || {}
  const hasActiveRuntimeRun = state.activeRun?.status === "running"
  const messages = hasActiveRuntimeRun
    ? state.messages
    : stabilizeThreadMessages(state.messages, snapshot.messages.messages)
  const permissionMode = metadata[THREAD_PERMISSION_MODE_METADATA_KEY]
  const bootstrap = deriveThreadBootstrapState({
    ...snapshot,
    messages: {
      ...snapshot.messages,
      messages
    }
  })

  const activeRun = hasActiveRuntimeRun
    ? state.activeRun
    : snapshot.thread.status === "busy"
      ? (state.activeRun ?? bootstrap.activeRun)
      : bootstrap.activeRun
  const activeProjectionInput = activeRun
    ? {
        activeAssistantId: activeRun.assistantMessageId,
        activeTurnKey: activeRun.turnId
      }
    : {}

  return {
    ...state,
    activeRun,
    artifacts: snapshot.messages.artifacts,
    currentModel: typeof metadata.model === "string" ? metadata.model : state.currentModel,
    error: hasActiveRuntimeRun ? state.error : (bootstrap.error?.message ?? null),
    forkState: snapshot.runState.forkState,
    messageProjection: projectMessages(messages, state.messageProjection, activeProjectionInput),
    messages,
    pendingApproval: hasActiveRuntimeRun ? state.pendingApproval : bootstrap.pendingApproval,
    permissionMode: isPermissionModeName(permissionMode) ? permissionMode : state.permissionMode,
    runId: hasActiveRuntimeRun ? state.runId : bootstrap.latestRunId,
    subagents: snapshot.thread.status === "busy" || hasActiveRuntimeRun ? state.subagents : [],
    title: snapshot.thread.title ?? state.title,
    todos: hasActiveRuntimeRun ? state.todos : bootstrap.todos,
    tokenUsage: snapshot.thread.status === "busy" || hasActiveRuntimeRun ? state.tokenUsage : null,
    workspacePath:
      typeof metadata.workspacePath === "string" ? metadata.workspacePath : state.workspacePath
  }
}
