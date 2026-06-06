import type { AgentThreadEvent, AgentThreadRuntimeState } from "@shared/agent-thread-runtime"
import { reduceAgentThreadRuntimeEvent } from "@shared/agent-thread-runtime"
import type { IpcErrorPayload } from "@shared/ipc-error"
import {
  projectMessages,
  updateProjectedMessage,
  type MessageProjectionOptions
} from "./message-projection"
import { stabilizeThreadMessages } from "./thread-message-stability"
import type { ThreadState, ThreadStateUpdate } from "./thread-store-core"

type RuntimeMessage = ThreadState["agent"]["messages"][number]

export function applyRuntimeEventsToThreadState(
  state: ThreadState,
  events: AgentThreadEvent[],
  options: { threadId: string }
): ThreadState {
  let nextState = state
  for (const event of events) {
    nextState = applyRuntimeEventToThreadState(nextState, event, options)
  }
  return nextState
}

export function createRuntimeThreadStateUpdate(nextState: ThreadState): ThreadStateUpdate {
  return {
    agent: {
      activeRun: nextState.agent.activeRun,
      error: nextState.agent.error,
      messages: nextState.agent.messages,
      pendingApproval: nextState.agent.pendingApproval,
      revision: nextState.agent.revision,
      runId: nextState.agent.runId,
      subagents: nextState.agent.subagents,
      todos: nextState.agent.todos,
      tokenUsage: nextState.agent.tokenUsage
    },
    view: {
      messageProjection: nextState.view.messageProjection
    }
  }
}

function applyRuntimeEventToThreadState(
  state: ThreadState,
  event: AgentThreadEvent,
  options: { threadId: string }
): ThreadState {
  if (event.revision <= state.agent.revision) {
    return state
  }

  const runtimeState = createRuntimeStateFromThreadState(state, options.threadId)
  const nextRuntimeState = reduceAgentThreadRuntimeEvent(runtimeState, event)
  if (nextRuntimeState === runtimeState) {
    return state
  }

  return applyRuntimeStateToThreadState(state, nextRuntimeState, {
    changedMessageId: getChangedMessageId(event)
  })
}

function parseRuntimeErrorMessage(error: Pick<IpcErrorPayload, "message">): string {
  return error.message
}

function getChangedMessageId(event: AgentThreadEvent): string | null {
  if (event.type !== "message.part.delta") {
    return null
  }

  return event.messageId
}

function createRuntimeErrorPayload(error: string | null): IpcErrorPayload | null {
  if (!error) {
    return null
  }

  return {
    code: "INTERNAL",
    message: error,
    status: 500
  }
}

function createActiveProjectionInput(
  runtimeState: AgentThreadRuntimeState
): MessageProjectionOptions {
  const activeRun = runtimeState.activeRun

  if (!activeRun) {
    return {}
  }

  return {
    activeAssistantId: activeRun.assistantMessageId,
    activeTurnKey: activeRun.turnId
  }
}

function findChangedAssistantMessage(
  messages: ThreadState["agent"]["messages"],
  changedMessageId: string | null | undefined
): RuntimeMessage | null {
  if (!changedMessageId) {
    return null
  }

  const changedMessage = messages.find((message) => message.id === changedMessageId)
  if (!changedMessage || changedMessage.role !== "assistant") {
    return null
  }

  return changedMessage
}

function projectRuntimeMessages(input: {
  activeProjectionInput: MessageProjectionOptions
  changedMessageId: string | null | undefined
  messages: ThreadState["agent"]["messages"]
  previousProjection: ThreadState["view"]["messageProjection"]
}): ThreadState["view"]["messageProjection"] {
  const changedAssistantMessage = findChangedAssistantMessage(
    input.messages,
    input.changedMessageId
  )

  if (changedAssistantMessage) {
    const fastPathResult = updateProjectedMessage(
      input.previousProjection,
      changedAssistantMessage,
      input.activeProjectionInput
    )

    if (fastPathResult.type === "hit") {
      return fastPathResult.projection
    }
  }

  return projectMessages(input.messages, input.previousProjection, input.activeProjectionInput)
}

function applyRuntimeStateToThreadState(
  state: ThreadState,
  runtimeState: AgentThreadRuntimeState,
  options: {
    changedMessageId?: string | null
  } = {}
): ThreadState {
  const messages = stabilizeThreadMessages(state.agent.messages, runtimeState.messagesPage)
  const activeProjectionInput = createActiveProjectionInput(runtimeState)
  const messageProjection = projectRuntimeMessages({
    activeProjectionInput,
    changedMessageId: options.changedMessageId,
    messages,
    previousProjection: state.view.messageProjection
  })

  return {
    ...state,
    agent: {
      ...state.agent,
      activeRun: runtimeState.activeRun,
      error: getRuntimeErrorMessage(runtimeState.error),
      messages,
      pendingApproval: runtimeState.pendingApproval,
      revision: runtimeState.revision,
      runId: runtimeState.latestRunId,
      subagents: runtimeState.subagents,
      todos: runtimeState.todos,
      tokenUsage: runtimeState.tokenUsage
    },
    view: {
      ...state.view,
      messageProjection
    }
  }
}

function getRuntimeErrorMessage(error: IpcErrorPayload | null): string | null {
  if (!error) {
    return null
  }

  return parseRuntimeErrorMessage(error)
}

function createRuntimeStateFromThreadState(
  state: ThreadState,
  threadId: string
): AgentThreadRuntimeState {
  return {
    activeRun: state.agent.activeRun,
    error: createRuntimeErrorPayload(state.agent.error),
    hasMoreBefore: false,
    latestRunId: state.agent.runId,
    messagesPage: state.agent.messages,
    pendingApproval: state.agent.pendingApproval,
    revision: state.agent.revision,
    status: getRuntimeStatusFromThreadState(state),
    subagents: state.agent.subagents,
    threadId,
    todos: state.agent.todos,
    tokenUsage: state.agent.tokenUsage
  }
}

function getRuntimeStatusFromThreadState(state: ThreadState): AgentThreadRuntimeState["status"] {
  if (state.agent.activeRun) {
    return "running"
  }

  if (state.agent.pendingApproval) {
    return "interrupted"
  }

  return "idle"
}
