import type {
  JingleAgentRuntimeReplayOptions,
  JingleAgentRuntimeSubscription,
  JingleRuntimeEventBatch
} from "@jingle/agent-client"
import {
  parseAgentConnectThreadEventsResult,
  type AgentThreadEvent,
  type AgentThreadEventSubscriptionSurface,
  type AgentThreadEventSubscriptionToken
} from "@shared/agent-thread-contract"

export interface AgentThreadEventConnectionOptions extends JingleAgentRuntimeReplayOptions {
  surface?: AgentThreadEventSubscriptionSurface
}

interface AgentThreadEventSubscriptionState {
  disposed: boolean
  generation: number
  subscriptionToken: AgentThreadEventSubscriptionToken | null
  threadId: string
}

export interface AgentThreadEventsTransport {
  connect(threadId: string, options: AgentThreadEventConnectionOptions): Promise<unknown>
  disconnect(threadId: string, subscriptionToken: AgentThreadEventSubscriptionToken): Promise<void>
  listen(
    threadId: string,
    listener: (batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void
  ): () => void
  reportError(message: string, error: unknown): void
}

export function createAgentThreadEventsApi(transport: AgentThreadEventsTransport): {
  connectThreadEvents(
    threadId: string,
    onBatch: (batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void,
    options?: AgentThreadEventConnectionOptions
  ): JingleAgentRuntimeSubscription
  replayThreadEvents(threadId: string, options?: AgentThreadEventConnectionOptions): Promise<void>
} {
  const activeSubscriptions = new Map<string, AgentThreadEventSubscriptionState>()

  const releaseSubscription = async (
    threadId: string,
    subscriptionToken: AgentThreadEventSubscriptionToken
  ): Promise<void> => {
    try {
      await transport.disconnect(threadId, subscriptionToken)
    } catch (error) {
      transport.reportError("[Agent] Failed to unsubscribe thread events:", error)
    }
  }

  const establishSubscription = async (
    state: AgentThreadEventSubscriptionState,
    options: AgentThreadEventConnectionOptions
  ): Promise<void> => {
    state.generation += 1
    const generation = state.generation

    let rawResult: unknown
    try {
      rawResult = await transport.connect(state.threadId, options)
    } catch (error) {
      if (state.disposed && state.subscriptionToken !== null) {
        await releaseSubscription(state.threadId, state.subscriptionToken)
      }
      if (
        !state.disposed &&
        activeSubscriptions.get(state.threadId) === state &&
        state.generation === generation
      ) {
        transport.reportError("[Agent] Failed to subscribe thread events:", error)
      }
      throw error
    }

    const { subscriptionToken } = parseAgentConnectThreadEventsResult(rawResult)
    if (
      state.disposed ||
      activeSubscriptions.get(state.threadId) !== state ||
      state.generation !== generation
    ) {
      await releaseSubscription(state.threadId, subscriptionToken)
      return
    }

    state.subscriptionToken = subscriptionToken
  }

  return {
    connectThreadEvents(threadId, onBatch, options = {}) {
      const removeListener = transport.listen(threadId, onBatch)
      const state: AgentThreadEventSubscriptionState = {
        disposed: false,
        generation: 0,
        subscriptionToken: null,
        threadId
      }
      activeSubscriptions.set(threadId, state)

      const ready = establishSubscription(state, options)
      ready.catch(() => {})

      const cleanup = (() => {
        if (state.disposed) {
          return
        }

        state.disposed = true
        state.generation += 1
        removeListener()
        if (activeSubscriptions.get(threadId) === state) {
          activeSubscriptions.delete(threadId)
        }

        const subscriptionToken = state.subscriptionToken
        if (subscriptionToken !== null) {
          void releaseSubscription(threadId, subscriptionToken)
        }
      }) as JingleAgentRuntimeSubscription

      cleanup.ready = ready
      return cleanup
    },
    replayThreadEvents(threadId, options = {}) {
      const state = activeSubscriptions.get(threadId)
      if (!state || state.disposed) {
        return Promise.reject(
          new Error(`Agent thread event subscription is not active: ${threadId}`)
        )
      }

      return establishSubscription(state, options)
    }
  }
}
