import type {
  AgentThreadEvent,
  AgentThreadRuntimeState,
  AgentThreadSnapshot
} from "@shared/agent-thread-runtime"
import { reduceAgentThreadRuntimeEvent } from "@shared/agent-thread-runtime"
import type { IpcErrorPayload } from "@shared/ipc-error"
import {
  projectMessages,
  updateProjectedMessage
} from "./message-projection"
import { stabilizeThreadMessages } from "./thread-message-stability"
import type { ThreadState } from "./thread-store-core"

export function applyRuntimeEventsToThreadState(
  state: ThreadState,
  events: AgentThreadEvent[]
): ThreadState {
  let nextState = state
  for (const event of events) {
    nextState = applyRuntimeEventToThreadState(nextState, event)
  }
  return nextState
}

export function applyRuntimeSnapshotToThreadState(
  state: ThreadState,
  snapshot: AgentThreadSnapshot
): ThreadState {
  if (snapshot.revision <= state.revision) {
    return state
  }

  return applyRuntimeStateToThreadState(state, snapshot)
}

export function createRuntimeThreadStateUpdate(nextState: ThreadState): Partial<ThreadState> {
  return {
    activeRun: nextState.activeRun,
    error: nextState.error,
    messageProjection: nextState.messageProjection,
    messages: nextState.messages,
    pendingApproval: nextState.pendingApproval,
    revision: nextState.revision,
    runId: nextState.runId,
    subagents: nextState.subagents,
    todos: nextState.todos,
    tokenUsage: nextState.tokenUsage
  }
}

function applyRuntimeEventToThreadState(state: ThreadState, event: AgentThreadEvent): ThreadState {
  if (event.revision <= state.revision) {
    return state
  }

  if (event.type === "thread.snapshot") {
    return applyRuntimeSnapshotToThreadState(state, event.snapshot)
  }

  const runtimeState = createRuntimeStateFromThreadState(state)
  const nextRuntimeState = reduceAgentThreadRuntimeEvent(runtimeState, event)
  if (nextRuntimeState === runtimeState) {
    return state
  }

  return applyRuntimeStateToThreadState(state, nextRuntimeState, {
    changedMessageId: event.type === "message.part.delta" ? event.messageId : null
  })
}

function parseRuntimeErrorMessage(error: Pick<IpcErrorPayload, "message">): string {
  return error.message
}

function applyRuntimeStateToThreadState(
  state: ThreadState,
  runtimeState: AgentThreadRuntimeState,
  options: { changedMessageId?: string | null } = {}
): ThreadState {
  const messages = stabilizeThreadMessages(state.messages, runtimeState.messagesPage)
  const changedMessage = options.changedMessageId
    ? messages.find((message) => message.id === options.changedMessageId)
    : null
  const messageProjection =
    changedMessage?.role === "assistant"
      ? updateProjectedMessage(state.messageProjection, changedMessage, {
          activeTurnKey: runtimeState.activeRun?.turnId ?? null
        }) ??
        projectMessages(messages, state.messageProjection, {
          activeTurnKey: runtimeState.activeRun?.turnId ?? null
        })
      : projectMessages(messages, state.messageProjection, {
          activeTurnKey: runtimeState.activeRun?.turnId ?? null
        })

  return {
    ...state,
    activeRun: runtimeState.activeRun,
    error: runtimeState.error ? parseRuntimeErrorMessage(runtimeState.error) : null,
    messageProjection,
    messages,
    pendingApproval: runtimeState.pendingApproval,
    revision: runtimeState.revision,
    runId: runtimeState.latestRunId,
    subagents: runtimeState.subagents,
    todos: runtimeState.todos,
    tokenUsage: runtimeState.tokenUsage
  }
}

function createRuntimeStateFromThreadState(state: ThreadState): AgentThreadRuntimeState {
  return {
    activeRun: state.activeRun,
    error: state.error
      ? {
          code: "INTERNAL",
          message: state.error,
          status: 500
        }
      : null,
    hasMoreBefore: false,
    latestRunId: state.runId,
    messagesPage: state.messages,
    pendingApproval: state.pendingApproval,
    revision: state.revision,
    status: state.activeRun ? "running" : state.pendingApproval ? "interrupted" : "idle",
    subagents: state.subagents,
    threadId: state.activeRun?.threadId ?? "",
    todos: state.todos,
    tokenUsage: state.tokenUsage
  }
}
