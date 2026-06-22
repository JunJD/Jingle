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

  function selectRuntimeBatch(batch: AgentThreadEventBatch) {
    const currentRevision = getInitializedThreadState(batch.threadId).agent.revision
    return selectRuntimeEventsAfterRevision(currentRevision, batch)
  }

  function collectPendingGapBatches(batches: AgentThreadEventBatch[]): Array<{
    batch: AgentThreadEventBatch
    selection: Extract<ReturnType<typeof selectRuntimeEventsAfterRevision>, { type: "gap" }>
  }> {
    const pendingGaps: Array<{
      batch: AgentThreadEventBatch
      selection: Extract<ReturnType<typeof selectRuntimeEventsAfterRevision>, { type: "gap" }>
    }> = []

    for (const batch of batches) {
      const selection = selectRuntimeBatch(batch)
      if (selection.type === "gap") {
        pendingGaps.push({ batch, selection })
      }
    }

    return pendingGaps
  }

  function findNextContiguousBatch(batches: AgentThreadEventBatch[]): number {
    for (const [index, batch] of batches.entries()) {
      const selection = selectRuntimeBatch(batch)
      if (selection.type === "events") {
        return index
      }
    }

    return -1
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

    const remainingBatches = batches
    delete pendingRuntimeBatches[threadId]

    while (remainingBatches.length > 0 && !runtimeResync[threadId]) {
      const nextBatchIndex = findNextContiguousBatch(remainingBatches)
      if (nextBatchIndex >= 0) {
        const [batch] = remainingBatches.splice(nextBatchIndex, 1)
        const currentRevision = getInitializedThreadState(batch.threadId).agent.revision
        const selection = selectRuntimeEventsAfterRevision(currentRevision, batch)
        if (selection.type !== "events") {
          continue
        }
        applyRuntimeEvents(batch.threadId, selection.events)
        continue
      }

      const pendingGaps = collectPendingGapBatches(remainingBatches)
      if (pendingGaps.length === 0) {
        return
      }

      pendingRuntimeBatches[threadId] = pendingGaps.map((entry) => entry.batch)
      const firstGap = pendingGaps[0]
      console.warn("[AgentRuntimeManager] Runtime event gap detected; resyncing event stream.", {
        actualRevision: firstGap.selection.actualRevision,
        expectedRevision: firstGap.selection.expectedRevision,
        threadId: firstGap.batch.threadId
      })
      startRuntimeResync(threadId)
    }
  }

  function applyRuntimeBatch(batch: AgentThreadEventBatch): void {
    if (runtimeResync[batch.threadId]) {
      const batches = pendingRuntimeBatches[batch.threadId] ?? []
      batches.push(batch)
      pendingRuntimeBatches[batch.threadId] = batches
      return
    }

    const selection = selectRuntimeBatch(batch)
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
    const fromRevision = getInitializedThreadState(threadId).agent.revision
    const subscription = window.api.agent.connectThreadEvents(
      threadId,
      (batch) => {
        applyRuntimeBatch(batch)
      },
      {
        fromRevision
      }
    )
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
    const fromRevision = getInitializedThreadState(threadId).agent.revision
    await window.api.agent.replayThreadEvents(threadId, { fromRevision })
  }

  function startRuntimeResync(threadId: string): void {
    if (runtimeResync[threadId]) {
      return
    }

    const resync = resyncThreadRuntime(threadId).catch((error) => {
      console.error("[AgentRuntimeManager] Runtime resync failed.", {
        entry: "runtimeResync",
        error,
        threadId
      })
    })
    runtimeResync[threadId] = resync
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
    try {
      if (isThreadStreaming(threadId)) {
        await replayThreadRuntimeEvents(threadId)
      } else {
        await loadThreadData(threadId)
      }
    } finally {
      runtimeResync[threadId] = null
      drainPendingRuntimeBatches(threadId)
    }
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
