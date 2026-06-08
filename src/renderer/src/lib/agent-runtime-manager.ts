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
    return getInitializedThreadState(threadId).agent.status === "running"
  }

  function applyRuntimeEvents(threadId: string, events: AgentThreadEvent[]): void {
    if (events.length === 0) {
      return
    }

    const wasLoading = isThreadStreaming(threadId)
    threadStore.applyRuntimeEvents(threadId, events)
    const state = getInitializedThreadState(threadId)
    const isLoading = state.agent.status === "running"

    if (wasLoading && !isLoading && hasHistoryRefreshEvent(events) && refreshThread) {
      startHistoryRefresh(threadId)
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
        startRuntimeResync(batch.threadId)
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
      startRuntimeResync(batch.threadId)
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

  function startRuntimeResync(threadId: string): void {
    void resyncThreadRuntime(threadId).catch((error) => {
      console.error("[AgentRuntimeManager] Runtime resync failed.", {
        entry: "runtimeResync",
        error,
        threadId
      })
    })
  }

  function startHistoryRefresh(threadId: string): void {
    if (!refreshThread) {
      return
    }

    void (async () => {
      try {
        await refreshThread(threadId)
      } catch (error) {
        console.error("[AgentRuntimeManager] History refresh failed.", {
          entry: "historyRefresh",
          error,
          threadId
        })
      }
    })()
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

    const resync = (async () => {
      try {
        await loadThreadData(threadId)
      } finally {
        runtimeResync[threadId] = null
        drainPendingRuntimeBatches(threadId)
      }
    })()

    runtimeResync[threadId] = resync
    await resync
  }

  async function loadThreadData(threadId: string): Promise<void> {
    await awaitThreadRuntime(threadId)
    const wasStreaming = isThreadStreaming(threadId)

    const threadData = await window.api.threads.getAgentThreadData(threadId)
    if (
      wasStreaming ||
      isThreadStreaming(threadId) ||
      threadData.thread.status === "busy" ||
      threadData.thread.status === "interrupted"
    ) {
      threadStore.applyThreadDataSnapshot(threadId, threadData)
      await replayThreadRuntimeEvents(threadId)
      return
    }

    threadStore.applyThreadDataSnapshot(threadId, threadData)
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

function hasHistoryRefreshEvent(events: AgentThreadEvent[]): boolean {
  return events.some(
    (event) => event.type === "run.finished" || event.type === "approval.requested"
  )
}
