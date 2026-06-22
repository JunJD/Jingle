import {
  reduceAgentThreadRuntimeEvent,
  type AgentThreadEvent,
  type AgentThreadRuntimeState
} from "@shared/agent-thread-runtime"
import {
  projectMessages,
  updateProjectedMessage,
  type MessageProjectionOptions
} from "./message-projection"
import { stabilizeThreadMessages } from "./thread-message-stability"
import type { AgentSourceState, ThreadState } from "./thread-store-core"

type RuntimeMessage = ThreadState["agent"]["messagesPage"][number]
type RuntimeEventProjectionUpdate = {
  agent: Pick<
    AgentSourceState,
    | "activeRun"
    | "contextInclusions"
    | "error"
    | "followUpQueue"
    | "latestRunId"
    | "messagesPage"
    | "pendingApproval"
    | "revision"
    | "status"
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
  let runtimeState: AgentThreadRuntimeState =
    state.agent.threadId === options.threadId
      ? state.agent
      : {
          ...state.agent,
          threadId: options.threadId
        }
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
    {
      ...state.agent,
      ...runtimeState
    },
    { changedMessageId }
  )
}

export function createRuntimeEventProjectionUpdate(
  nextState: ThreadState
): RuntimeEventProjectionUpdate {
  return {
    agent: {
      activeRun: nextState.agent.activeRun,
      contextInclusions: nextState.agent.contextInclusions,
      error: nextState.agent.error,
      followUpQueue: nextState.agent.followUpQueue,
      latestRunId: nextState.agent.latestRunId,
      messagesPage: nextState.agent.messagesPage,
      pendingApproval: nextState.agent.pendingApproval,
      revision: nextState.agent.revision,
      status: nextState.agent.status,
      subagents: nextState.agent.subagents,
      todos: nextState.agent.todos,
      tokenUsage: nextState.agent.tokenUsage
    },
    view: {
      messageProjection: nextState.view.messageProjection
    }
  }
}

function createActiveProjectionInput(agent: AgentSourceState): MessageProjectionOptions {
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
  messages: ThreadState["agent"]["messagesPage"],
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

function canReuseProjectionWithoutMessageChanges(
  previousProjection: ThreadState["view"]["messageProjection"],
  activeProjectionInput: MessageProjectionOptions
): boolean {
  if (activeProjectionInput.activeTurnKey === undefined) {
    return false
  }

  return (
    previousProjection.activeAssistantId === (activeProjectionInput.activeAssistantId ?? null) &&
    previousProjection.activeTurnKey === (activeProjectionInput.activeTurnKey ?? null)
  )
}

function projectRuntimeMessages(input: {
  activeProjectionInput: MessageProjectionOptions
  changedMessageId: string | null | undefined
  messages: ThreadState["agent"]["messagesPage"]
  messagesChanged: boolean
  previousProjection: ThreadState["view"]["messageProjection"]
}): ThreadState["view"]["messageProjection"] {
  if (
    !input.messagesChanged &&
    canReuseProjectionWithoutMessageChanges(input.previousProjection, input.activeProjectionInput)
  ) {
    return input.previousProjection
  }

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
  const messagesPage = stabilizeThreadMessages(state.agent.messagesPage, agent.messagesPage)
  const messagesChanged = !Object.is(messagesPage, state.agent.messagesPage)
  const activeProjectionInput = createActiveProjectionInput(agent)
  const messageProjection = projectRuntimeMessages({
    activeProjectionInput,
    changedMessageId: options.changedMessageId,
    messages: messagesPage,
    messagesChanged,
    previousProjection: state.view.messageProjection
  })

  return {
    ...state,
    agent: {
      ...agent,
      messagesPage
    },
    view: {
      ...state.view,
      messageProjection
    }
  }
}
