import {
  reduceAgentThreadRuntimeEvent,
  type AgentThreadEvent,
  type AgentThreadRuntimeState
} from "@shared/agent-thread-runtime"
import type { IpcErrorPayload } from "@shared/ipc-error"
import {
  projectMessages,
  updateProjectedMessage,
  type MessageProjectionOptions
} from "./message-projection"
import { stabilizeThreadMessages } from "./thread-message-stability"
import type { AgentSourceState, ThreadState } from "./thread-store-core"

type RuntimeMessage = ThreadState["agent"]["messages"][number]
type RuntimeEventProjectionUpdate = {
  agent: Pick<
    AgentSourceState,
    | "activeRun"
    | "error"
    | "messages"
    | "pendingApproval"
    | "revision"
    | "runId"
    | "subagents"
    | "todos"
    | "tokenUsage"
  >
  view: {
    messageProjection: ThreadState["view"]["messageProjection"]
  }
}

export function applyRuntimeEventsToThreadState(
  state: ThreadState,
  events: AgentThreadEvent[],
  options: { threadId: string }
): ThreadState {
  let runtimeState = toRuntimeState(state.agent, options.threadId)
  const initialRuntimeState = runtimeState
  let changedMessageId: string | null = null

  for (const event of events) {
    const previousRuntimeState = runtimeState
    runtimeState = reduceAgentThreadRuntimeEvent(runtimeState, event)

    if (runtimeState === previousRuntimeState) {
      continue
    }

    changedMessageId = event.type === "message.part.delta" ? event.messageId : null
  }

  if (runtimeState === initialRuntimeState) {
    return state
  }

  return applyAgentSourceStateToThreadState(
    state,
    toAgentSourceState(state.agent, runtimeState),
    { changedMessageId }
  )
}

export function createRuntimeEventProjectionUpdate(
  nextState: ThreadState
): RuntimeEventProjectionUpdate {
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

function createActiveProjectionInput(
  agent: AgentSourceState
): MessageProjectionOptions {
  const activeRun = agent.activeRun

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

function applyAgentSourceStateToThreadState(
  state: ThreadState,
  agent: AgentSourceState,
  options: {
    changedMessageId?: string | null
  } = {}
): ThreadState {
  const messages = stabilizeThreadMessages(state.agent.messages, agent.messages)
  const activeProjectionInput = createActiveProjectionInput(agent)
  const messageProjection = projectRuntimeMessages({
    activeProjectionInput,
    changedMessageId: options.changedMessageId,
    messages,
    previousProjection: state.view.messageProjection
  })

  return {
    ...state,
    agent: {
      ...agent,
      messages
    },
    view: {
      ...state.view,
      messageProjection
    }
  }
}

function toRuntimeError(error: string | null): IpcErrorPayload | null {
  if (!error) {
    return null
  }

  return {
    code: "INTERNAL",
    message: error,
    status: 500
  }
}

function toRuntimeState(agent: AgentSourceState, threadId: string): AgentThreadRuntimeState {
  return {
    activeRun: agent.activeRun,
    error: toRuntimeError(agent.error),
    hasMoreBefore: false,
    latestRunId: agent.runId,
    messagesPage: agent.messages,
    pendingApproval: agent.pendingApproval,
    revision: agent.revision,
    status: "idle",
    subagents: agent.subagents,
    threadId,
    todos: agent.todos,
    tokenUsage: agent.tokenUsage
  }
}

function toAgentSourceState(
  previousAgent: AgentSourceState,
  runtimeState: AgentThreadRuntimeState
): AgentSourceState {
  return {
    ...previousAgent,
    activeRun: runtimeState.activeRun,
    error: runtimeState.error?.message ?? null,
    messages: runtimeState.messagesPage,
    pendingApproval: runtimeState.pendingApproval,
    revision: runtimeState.revision,
    runId: runtimeState.latestRunId,
    subagents: runtimeState.subagents,
    todos: runtimeState.todos,
    tokenUsage: runtimeState.tokenUsage
  }
}
