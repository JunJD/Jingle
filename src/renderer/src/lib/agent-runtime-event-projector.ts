import {
  applyJingleRuntimeEvents,
  reduceJingleAgentThreadRuntimeEvent
} from "@jingle/agent-client"
import {
  canReuseJingleMessageProjection,
  findJingleChangedAssistantMessage,
  selectJingleActiveMessageProjectionInput
} from "@jingle/agent-react"
import {
  projectMessages,
  updateProjectedMessage,
  type MessageProjectionOptions
} from "./message-projection"
import { stabilizeJingleMessageList } from "@jingle/agent-react"
import type {
  AgentSourceState,
  AgentThreadEvent,
  AgentThreadRuntimeState,
  ThreadState
} from "./thread-store-core"

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
  const runtimeState: AgentThreadRuntimeState =
    state.agent.threadId === options.threadId
      ? state.agent
      : {
          ...state.agent,
          threadId: options.threadId
        }
  const result = applyJingleRuntimeEvents(runtimeState, events, {
    readChangedMessageId: readChangedMessageIdFromRuntimeEvent,
    reduceEvent: reduceJingleAgentThreadRuntimeEvent
  })

  if (!result.changed) {
    return state
  }

  return applyAgentSourceStateToThreadState(
    state,
    {
      ...state.agent,
      ...result.state
    },
    { changedMessageId: result.changedMessageId }
  )
}

function readChangedMessageIdFromRuntimeEvent(event: AgentThreadEvent): string | null {
  return event.type === "message.part.delta" ? event.messageId : null
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
      todos: nextState.agent.todos,
      tokenUsage: nextState.agent.tokenUsage
    },
    view: {
      messageProjection: nextState.view.messageProjection
    }
  }
}

function projectRuntimeMessages(input: {
  activeProjectionInput: MessageProjectionOptions
  changedMessageId: string | null | undefined
  messages: ThreadState["agent"]["messagesPage"]
  messagesChanged: boolean
  previousProjection: ThreadState["view"]["messageProjection"]
}): ThreadState["view"]["messageProjection"] {
  if (canReuseJingleMessageProjection(input)) {
    return input.previousProjection
  }

  const changedAssistantMessage = findJingleChangedAssistantMessage(
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
  const messagesPage = stabilizeJingleMessageList(state.agent.messagesPage, agent.messagesPage)
  const messagesChanged = !Object.is(messagesPage, state.agent.messagesPage)
  const activeProjectionInput = selectJingleActiveMessageProjectionInput(agent.activeRun)
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
