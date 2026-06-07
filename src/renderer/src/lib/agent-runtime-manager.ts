import type { AgentThreadEvent, AgentThreadEventBatch } from "@shared/agent-thread-runtime"
import { selectRuntimeEventsAfterRevision } from "./thread-runtime-batch"
import type { ThreadStore } from "./thread-store-core"

export interface AgentRuntimeManager {
  awaitThreadRuntime: (threadId: string) => Promise<void>
  cleanupThreadRuntime: (threadId: string) => void
  ensureThreadRuntime: (threadId: string) => void
  loadThreadData: (threadId: string) => Promise<void>
}

export interface AgentRuntimeManagerOptions {
  refreshThread?: (threadId: string) => void | Promise<void>
  threadStore: ThreadStore
}

export function createAgentRuntimeManager({
  refreshThread,
  threadStore
}: AgentRuntimeManagerOptions): AgentRuntimeManager {
  const initializedThreads = new Set<string>()
  const runtimeCleanup: Record<string, () => void> = {}
  const pendingRuntimeBatches: Record<string, AgentThreadEventBatch[]> = {}
  const runtimeResync: Record<string, Promise<void> | null> = {}
  const runtimeReady: Record<string, Promise<void>> = {}

  function getInitializedThreadState(threadId: string) {
    const state = threadStore.getThreadState(threadId)
    if (!state) {
      throw new Error(`Agent runtime thread state is not initialized: ${threadId}`)
    }
    return state
  }

  function isThreadStreaming(threadId: string): boolean {
    const activeRun = getInitializedThreadState(threadId).agent.activeRun
    return Boolean(activeRun && activeRun.status === "running")
  }

  function applyRuntimeEvents(threadId: string, events: AgentThreadEvent[]): void {
    if (events.length === 0) {
      return
    }

    const wasLoading = isThreadStreaming(threadId)
    threadStore.applyRuntimeEvents(
      threadId,
      events.map((event) =>
        event.type === "thread.statusChanged" && event.error
          ? {
              ...event,
              error: {
                ...event.error,
                message: getDisplayErrorMessage(event.error.message)
              }
            }
          : event
      )
    )
    const state = getInitializedThreadState(threadId)
    const isLoading = Boolean(state.agent.activeRun && state.agent.activeRun.status === "running")

    if (wasLoading && !isLoading && hasHistoryRefreshEvent(events) && refreshThread) {
      void refreshThread(threadId)
    }
  }

  function drainPendingRuntimeBatches(threadId: string): void {
    const batches = pendingRuntimeBatches[threadId]
    if (!batches || batches.length === 0 || runtimeResync[threadId]) {
      return
    }

    delete pendingRuntimeBatches[threadId]
    for (const batch of batches) {
      const currentRevision = getInitializedThreadState(batch.threadId).agent.revision
      const selection = selectRuntimeEventsAfterRevision(currentRevision, batch)
      if (selection.type === "events") {
        applyRuntimeEvents(batch.threadId, selection.events)
        continue
      }

      if (selection.type === "gap") {
        console.warn("[AgentRuntimeManager] Runtime event gap detected; resyncing event stream.", {
          actualRevision: selection.actualRevision,
          expectedRevision: selection.expectedRevision,
          threadId: batch.threadId
        })
        void resyncThreadRuntime(batch.threadId)
        return
      }
    }
  }

  function applyRuntimeBatch(batch: AgentThreadEventBatch): void {
    if (runtimeResync[batch.threadId]) {
      const batches = pendingRuntimeBatches[batch.threadId] ?? []
      batches.push(batch)
      pendingRuntimeBatches[batch.threadId] = batches
      return
    }

    const currentRevision = getInitializedThreadState(batch.threadId).agent.revision
    const selection = selectRuntimeEventsAfterRevision(currentRevision, batch)
    if (selection.type === "events") {
      applyRuntimeEvents(batch.threadId, selection.events)
      return
    }

    if (selection.type === "gap") {
      console.warn("[AgentRuntimeManager] Runtime event gap detected; resyncing event stream.", {
        actualRevision: selection.actualRevision,
        expectedRevision: selection.expectedRevision,
        threadId: batch.threadId
      })
      void resyncThreadRuntime(batch.threadId)
    }
  }

  function ensureThreadRuntime(threadId: string): void {
    if (initializedThreads.has(threadId)) {
      return
    }

    initializedThreads.add(threadId)
    threadStore.ensureThreadState(threadId)
    const subscription = window.api.agent.connectThreadEvents(threadId, (batch) => {
      applyRuntimeBatch(batch)
    })
    runtimeCleanup[threadId] = subscription
    runtimeReady[threadId] = subscription.ready
  }

  async function awaitThreadRuntime(threadId: string): Promise<void> {
    ensureThreadRuntime(threadId)
    await (runtimeReady[threadId] ?? Promise.resolve())
  }

  async function replayThreadRuntimeEvents(threadId: string): Promise<void> {
    ensureThreadRuntime(threadId)
    await (runtimeReady[threadId] ?? Promise.resolve())
    await window.api.agent.replayThreadEvents(threadId)
  }

  async function resyncThreadRuntime(threadId: string): Promise<void> {
    if (isThreadStreaming(threadId)) {
      await replayThreadRuntimeEvents(threadId)
      return
    }

    if (runtimeResync[threadId]) {
      await runtimeResync[threadId]
      return
    }

    const resync = loadThreadData(threadId)
      .catch((error) => {
        console.error("[AgentRuntimeManager] Failed to resync thread runtime:", error)
      })
      .finally(() => {
        runtimeResync[threadId] = null
        drainPendingRuntimeBatches(threadId)
      })

    runtimeResync[threadId] = resync
    await resync
  }

  async function loadThreadData(threadId: string): Promise<void> {
    await awaitThreadRuntime(threadId)
    if (isThreadStreaming(threadId)) {
      await replayThreadRuntimeEvents(threadId)
      return
    }

    try {
      const threadData = await window.api.threads.getAgentThreadData(threadId)
      if (isThreadStreaming(threadId)) {
        return
      }

      threadStore.applyThreadDataSnapshot(threadId, threadData)
    } catch (error) {
      console.error("[AgentRuntimeManager] Failed to load thread data:", error)
    }
  }

  function cleanupThreadRuntime(threadId: string): void {
    initializedThreads.delete(threadId)
    runtimeCleanup[threadId]?.()
    delete runtimeCleanup[threadId]
    delete pendingRuntimeBatches[threadId]
    delete runtimeResync[threadId]
    delete runtimeReady[threadId]
  }

  return {
    awaitThreadRuntime,
    cleanupThreadRuntime,
    ensureThreadRuntime,
    loadThreadData
  }
}

function getDisplayErrorMessage(errorMessage: string): string {
  const contextWindowMatch = errorMessage.match(/prompt is too long: (\d+) tokens > (\d+) maximum/i)
  if (contextWindowMatch) {
    const [, usedTokens, maxTokens] = contextWindowMatch
    const usedK = Math.round(parseInt(usedTokens, 10) / 1000)
    const maxK = Math.round(parseInt(maxTokens, 10) / 1000)
    return `Context window exceeded (${usedK}K / ${maxK}K tokens). The conversation history is too long. Please start a new thread to continue.`
  }

  if (errorMessage.includes("rate_limit") || errorMessage.includes("429")) {
    return "Rate limit exceeded. Please wait a moment before sending another message."
  }

  if (
    errorMessage.includes("401") ||
    errorMessage.includes("invalid_api_key") ||
    errorMessage.includes("authentication")
  ) {
    return "Authentication failed. Please check your API key in settings."
  }

  return errorMessage
}

function hasHistoryRefreshEvent(events: AgentThreadEvent[]): boolean {
  return events.some(
    (event) => event.type === "run.finished" || event.type === "approval.requested"
  )
}
