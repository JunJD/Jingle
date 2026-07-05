import type { AgentThreadDataSnapshot } from "@shared/app-types"
import type { AgentThreadEventSubscriptionSurface } from "@shared/agent-thread-contract"
import {
  createJingleAgentRuntimeClient,
  type JingleAgentRuntimeReplayOptions
} from "@jingle/agent-client"
import type { ThreadStore } from "./thread-store-core"

type AgentRuntimeManagerEvent = Parameters<ThreadStore["applyRuntimeEvents"]>[1][number]

export interface AgentRuntimeManager {
  awaitThreadRuntime: (threadId: string) => Promise<void>
  cleanupThreadRuntime: (threadId: string) => void
  ensureThreadRuntime: (threadId: string) => void
  loadThreadData: (threadId: string) => Promise<void>
}

export interface AgentRuntimeManagerOptions {
  eventSurface?: AgentThreadEventSubscriptionSurface
  refreshThread?: (threadId: string) => void | Promise<void>
  threadStore: ThreadStore
}

function shouldRefreshThreadHistory(events: readonly AgentRuntimeManagerEvent[]): boolean {
  return events.some(
    (event) => event.type === "run.finished" || event.type === "approval.requested"
  )
}

function withEventSurface(
  options: JingleAgentRuntimeReplayOptions,
  eventSurface: AgentThreadEventSubscriptionSurface | undefined
): JingleAgentRuntimeReplayOptions & {
  surface?: AgentThreadEventSubscriptionSurface
} {
  if (eventSurface === undefined) {
    return options
  }

  return {
    ...options,
    surface: eventSurface
  }
}

export function createAgentRuntimeManager({
  eventSurface,
  refreshThread,
  threadStore
}: AgentRuntimeManagerOptions): AgentRuntimeManager {
  function getInitializedThreadState(threadId: string) {
    const state = threadStore.getThreadState(threadId)
    if (!state) {
      throw new Error(`Agent runtime thread state is not initialized: ${threadId}`)
    }
    return state
  }

  return createJingleAgentRuntimeClient<AgentThreadDataSnapshot, AgentRuntimeManagerEvent>({
    applyRuntimeEvents: (threadId, events) => {
      threadStore.applyRuntimeEvents(threadId, events)
    },
    applyThreadDataSnapshot: (threadId, snapshot) => {
      threadStore.applyThreadDataSnapshot(threadId, snapshot)
    },
    connectThreadEvents: (threadId, listener, options) =>
      window.api.agent.connectThreadEvents(
        threadId,
        listener,
        withEventSurface(options, eventSurface)
      ),
    ensureThreadState: (threadId) => {
      threadStore.ensureThreadState(threadId)
    },
    getRevision: (threadId) => getInitializedThreadState(threadId).agent.revision,
    getStatus: (threadId) => getInitializedThreadState(threadId).agent.status,
    loadThreadDataSnapshot: (threadId) => window.api.threads.getAgentThreadData(threadId),
    readSnapshotThreadStatus: (snapshot) => snapshot.thread.status,
    refreshThread,
    replayThreadEvents: (threadId, options: JingleAgentRuntimeReplayOptions) =>
      window.api.agent.replayThreadEvents(threadId, withEventSurface(options, eventSurface)),
    reportError: (message, payload) => {
      console.error(message, payload)
    },
    reportWarning: (message, payload) => {
      console.warn(message, payload)
    },
    shouldRefreshThreadHistory
  })
}
