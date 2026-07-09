import {
  selectRuntimeEventsAfterRevision,
  type JingleRuntimeEventBatch,
  type JingleRuntimeEventRevision,
  type RuntimeBatchSelection
} from "./cursor"

export interface JingleAgentRuntimeSubscription {
  (): void
  ready: Promise<void>
}

export interface JingleAgentRuntimeReplayOptions {
  fromRevision?: number
}

export interface JingleAgentRuntimeClientEvent extends JingleRuntimeEventRevision {
  type: string
}

export interface JingleAgentRuntimeClientPorts<
  TSnapshot,
  TEvent extends JingleAgentRuntimeClientEvent = JingleAgentRuntimeClientEvent
> {
  applyRuntimeEvents: (threadId: string, events: TEvent[]) => void
  applyThreadDataSnapshot: (threadId: string, snapshot: TSnapshot) => void
  connectThreadEvents: (
    threadId: string,
    listener: (batch: JingleRuntimeEventBatch<TEvent>) => void,
    options: JingleAgentRuntimeReplayOptions
  ) => JingleAgentRuntimeSubscription
  ensureThreadState: (threadId: string) => void
  getRevision: (threadId: string) => number
  getStatus: (threadId: string) => string
  loadThreadDataSnapshot: (threadId: string) => Promise<TSnapshot>
  readSnapshotThreadStatus: (snapshot: TSnapshot) => "busy" | "interrupted" | string
  refreshThread?: (threadId: string) => void | Promise<void>
  replayThreadEvents: (threadId: string, options: JingleAgentRuntimeReplayOptions) => Promise<void>
  reportError: (message: string, payload: Record<string, unknown>) => void
  reportWarning: (message: string, payload: Record<string, unknown>) => void
  shouldRefreshThreadHistory?: (events: readonly TEvent[]) => boolean
}

export interface JingleAgentRuntimeClient {
  awaitThreadRuntime: (threadId: string) => Promise<void>
  cleanupThreadRuntime: (threadId: string) => void
  ensureThreadRuntime: (threadId: string) => void
  loadThreadData: (threadId: string) => Promise<void>
}

type RuntimeGapSelection<TEvent extends JingleAgentRuntimeClientEvent> = Extract<
  RuntimeBatchSelection<TEvent>,
  { type: "gap" }
>

const JINGLE_AGENT_RUNTIME_CLIENT_LOG_PREFIX = "[JingleAgentRuntimeClient]"

export function createJingleAgentRuntimeClient<
  TSnapshot,
  TEvent extends JingleAgentRuntimeClientEvent = JingleAgentRuntimeClientEvent
>(ports: JingleAgentRuntimeClientPorts<TSnapshot, TEvent>): JingleAgentRuntimeClient {
  const initializedThreads = new Set<string>()
  const runtimeCleanup: Record<string, () => void> = {}
  const pendingRuntimeBatches: Record<string, JingleRuntimeEventBatch<TEvent>[]> = {}
  const runtimeResync: Record<string, Promise<void> | null> = {}
  const runtimeReady: Record<string, Promise<void>> = {}

  function isThreadStreaming(threadId: string): boolean {
    return ports.getStatus(threadId) === "running"
  }

  function selectRuntimeBatch(
    batch: JingleRuntimeEventBatch<TEvent>
  ): RuntimeBatchSelection<TEvent> {
    return selectRuntimeEventsAfterRevision(ports.getRevision(batch.threadId), batch)
  }

  function collectPendingGapBatches(batches: JingleRuntimeEventBatch<TEvent>[]): Array<{
    batch: JingleRuntimeEventBatch<TEvent>
    selection: RuntimeGapSelection<TEvent>
  }> {
    const pendingGaps: Array<{
      batch: JingleRuntimeEventBatch<TEvent>
      selection: RuntimeGapSelection<TEvent>
    }> = []

    for (const batch of batches) {
      const selection = selectRuntimeBatch(batch)
      if (selection.type === "gap") {
        pendingGaps.push({ batch, selection })
      }
    }

    return pendingGaps
  }

  function findNextContiguousBatch(batches: JingleRuntimeEventBatch<TEvent>[]): number {
    for (const [index, batch] of batches.entries()) {
      const selection = selectRuntimeBatch(batch)
      if (selection.type === "events") {
        return index
      }
    }

    return -1
  }

  function applyRuntimeEvents(threadId: string, events: TEvent[]): void {
    if (events.length === 0) {
      return
    }

    const wasLoading = isThreadStreaming(threadId)
    ports.applyRuntimeEvents(threadId, events)
    const isLoading = isThreadStreaming(threadId)

    if (
      wasLoading &&
      !isLoading &&
      ports.shouldRefreshThreadHistory?.(events)
    ) {
      startPostRunRefresh(threadId)
    }
  }

  function reportRuntimeGap(threadId: string, selection: RuntimeGapSelection<TEvent>): void {
    ports.reportWarning(
      `${JINGLE_AGENT_RUNTIME_CLIENT_LOG_PREFIX} Runtime event gap detected; resyncing event stream.`,
      {
        actualRevision: selection.actualRevision,
        expectedRevision: selection.expectedRevision,
        threadId
      }
    )
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
        const selection = selectRuntimeBatch(batch)
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
      reportRuntimeGap(firstGap.batch.threadId, firstGap.selection)
      startRuntimeResync(threadId)
    }
  }

  function applyRuntimeBatch(batch: JingleRuntimeEventBatch<TEvent>): void {
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
      reportRuntimeGap(batch.threadId, selection)
      startRuntimeResync(batch.threadId)
    }
  }

  function ensureThreadRuntime(threadId: string): void {
    if (initializedThreads.has(threadId)) {
      return
    }

    initializedThreads.add(threadId)
    ports.ensureThreadState(threadId)
    const fromRevision = ports.getRevision(threadId)
    const subscription = ports.connectThreadEvents(threadId, applyRuntimeBatch, { fromRevision })
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
    await ports.replayThreadEvents(threadId, { fromRevision: ports.getRevision(threadId) })
  }

  function startRuntimeResync(threadId: string): void {
    if (runtimeResync[threadId]) {
      return
    }

    const resync = resyncThreadRuntime(threadId).catch((error) => {
      ports.reportError(`${JINGLE_AGENT_RUNTIME_CLIENT_LOG_PREFIX} Runtime resync failed.`, {
        entry: "runtimeResync",
        error,
        threadId
      })
    })
    runtimeResync[threadId] = resync
  }

  function startPostRunRefresh(threadId: string): void {
    void (async () => {
      try {
        await loadThreadData(threadId)
      } catch (error) {
        ports.reportError(`${JINGLE_AGENT_RUNTIME_CLIENT_LOG_PREFIX} Thread data refresh failed.`, {
          entry: "threadDataRefresh",
          error,
          threadId
        })
      }

      if (!ports.refreshThread) {
        return
      }

      try {
        await ports.refreshThread?.(threadId)
      } catch (error) {
        ports.reportError(`${JINGLE_AGENT_RUNTIME_CLIENT_LOG_PREFIX} History refresh failed.`, {
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

    const threadData = await ports.loadThreadDataSnapshot(threadId)
    const threadStatus = ports.readSnapshotThreadStatus(threadData)
    if (
      wasStreaming ||
      isThreadStreaming(threadId) ||
      threadStatus === "busy"
    ) {
      ports.applyThreadDataSnapshot(threadId, threadData)
      await replayThreadRuntimeEvents(threadId)
      return
    }

    ports.applyThreadDataSnapshot(threadId, threadData)
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
