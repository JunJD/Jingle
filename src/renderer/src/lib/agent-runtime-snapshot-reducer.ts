import { applyJingleRuntimeSnapshotSourceState } from "@jingle/agent-client"
import {
  selectJingleActiveMessageProjectionInput,
  stabilizeJingleMessageList,
  stabilizeJingleReferences
} from "@jingle/agent-react"
import { isPermissionModeName, THREAD_PERMISSION_MODE_METADATA_KEY } from "@shared/permission-mode"
import { DEFAULT_PERMISSION_MODE } from "@shared/permission-mode"
import { deriveThreadBootstrapState } from "@shared/agent-thread-bootstrap"
import type { AgentThreadDataSnapshot, ThreadModelRuntimeSelectionState } from "@shared/app-types"
import { parseAgentRunRecoveryRequired } from "@shared/agent-run-recovery"
import { projectMessages } from "./message-projection"
import type { ThreadState } from "./thread-store-core"

function toRuntimeSnapshotStatus(
  snapshot: AgentThreadDataSnapshot
): ThreadState["agent"]["status"] {
  const recovery = snapshot.runState.recovery
    ? parseAgentRunRecoveryRequired(snapshot.runState.recovery)
    : null
  if (snapshot.runState.recovery && !recovery) {
    throw new Error("Agent thread snapshot contains an invalid run recovery fact.")
  }
  if (recovery) {
    return "recovery_required"
  }

  const status = snapshot.thread.status
  if (status === "error") {
    return "error"
  }

  return "idle"
}

export function applyRuntimeSnapshotToThreadState(
  state: ThreadState,
  snapshot: AgentThreadDataSnapshot
): ThreadState {
  const metadata = snapshot.thread.metadata || {}
  const snapshotApplication = applyJingleRuntimeSnapshotSourceState({
    current: {
      activeRun: state.agent.activeRun,
      contextInclusions: state.agent.contextInclusions,
      error: state.agent.error,
      followUpQueue: state.agent.followUpQueue,
      latestRunId: state.agent.latestRunId,
      messagesPage: state.agent.messagesPage,
      pendingApproval: state.agent.pendingApproval,
      revision: state.agent.revision,
      status: state.agent.status,
      todos: state.agent.todos,
      tokenUsage: state.agent.tokenUsage
    },
    snapshot: {
      contextInclusions: snapshot.runState.contextInclusions,
      error: snapshot.runState.error,
      messagesPage: snapshot.messages.messages,
      sourceStatus: toRuntimeSnapshotStatus(snapshot),
      threadStatus: snapshot.thread.status
    }
  })
  const snapshotPolicy = snapshotApplication.policy
  const sourceState = snapshotApplication.state
  const bootstrapState =
    snapshotPolicy.canApplyRuntimeState && snapshot.thread.status === "interrupted"
      ? deriveThreadBootstrapState(snapshot)
      : null
  const messagesPage = snapshotPolicy.canApplyContent
    ? stabilizeJingleMessageList(state.agent.messagesPage, sourceState.messagesPage)
    : sourceState.messagesPage
  const permissionMode = metadata[THREAD_PERMISSION_MODE_METADATA_KEY]
  const canApplyModelRuntimeSelection =
    snapshot.thread.modelRuntimeSelectionRevision >= state.agent.modelRuntimeSelectionRevision
  const modelRuntimeSelection = canApplyModelRuntimeSelection
    ? stabilizeModelRuntimeSelection(
        state.agent.modelRuntimeSelection,
        snapshot.thread.modelRuntimeSelection
      )
    : state.agent.modelRuntimeSelection
  const modelRuntimeSelectionRevision = canApplyModelRuntimeSelection
    ? snapshot.thread.modelRuntimeSelectionRevision
    : state.agent.modelRuntimeSelectionRevision
  const currentModel =
    modelRuntimeSelection.kind === "ready"
      ? modelRuntimeSelection.selection.modelId
      : modelRuntimeSelection.kind === "legacy_missing_effort"
        ? modelRuntimeSelection.modelId
        : null

  const artifacts = snapshotPolicy.canApplyContent
    ? stabilizeJingleReferences(state.agent.artifacts, snapshot.messages.artifacts)
    : state.agent.artifacts
  const approvals = snapshotPolicy.canApplyRuntimeState
    ? stabilizeJingleReferences(state.agent.approvals, snapshot.runState.approvals)
    : state.agent.approvals
  const forkState = snapshotPolicy.canApplyContent
    ? stabilizeJingleReferences(state.agent.forkState, snapshot.runState.forkState)
    : state.agent.forkState
  const contextInclusions = snapshotPolicy.canApplyRuntimeState
    ? stabilizeJingleReferences(state.agent.contextInclusions, sourceState.contextInclusions)
    : sourceState.contextInclusions
  const nextAgentState: ThreadState["agent"] = {
    ...state.agent,
    activeRun: bootstrapState?.activeRun ?? sourceState.activeRun,
    approvals,
    artifacts,
    contextInclusions,
    currentModel,
    error: bootstrapState?.error ?? sourceState.error,
    forkState,
    hasMoreBefore: false,
    followUpQueue: sourceState.followUpQueue,
    messagesPage,
    modelRuntimeSelection,
    modelRuntimeSelectionRevision,
    pendingApproval: bootstrapState?.pendingApproval ?? sourceState.pendingApproval,
    pendingApprovalRunModelRuntimeRecovery:
      snapshot.runState.pendingApprovalRunModelRuntimeRecovery,
    permissionMode: isPermissionModeName(permissionMode) ? permissionMode : DEFAULT_PERMISSION_MODE,
    latestRunId: bootstrapState?.latestRunId ?? sourceState.latestRunId,
    status: bootstrapState?.status ?? sourceState.status,
    threadId: snapshot.thread.thread_id,
    todos: bootstrapState?.todos ?? sourceState.todos,
    tokenUsage: sourceState.tokenUsage,
    workspacePath: snapshot.runState.workspacePath
  }

  return {
    ...state,
    agent: nextAgentState,
    view: {
      ...state.view,
      messageProjection: projectMessages(
        messagesPage,
        state.view.messageProjection,
        selectJingleActiveMessageProjectionInput(nextAgentState.activeRun)
      )
    }
  }
}

function stabilizeModelRuntimeSelection(
  current: ThreadModelRuntimeSelectionState,
  next: ThreadModelRuntimeSelectionState
): ThreadModelRuntimeSelectionState {
  if (current.kind !== next.kind) {
    return next
  }
  if (current.kind === "ready" && next.kind === "ready") {
    return current.selection.version === next.selection.version &&
      current.selection.modelId === next.selection.modelId &&
      current.selection.thinkingEffort === next.selection.thinkingEffort
      ? current
      : next
  }
  if (current.kind === "legacy_missing_effort" && next.kind === "legacy_missing_effort") {
    return current.modelId === next.modelId ? current : next
  }
  return current
}
