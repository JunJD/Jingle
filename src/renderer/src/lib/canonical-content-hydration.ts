import type { AssistantContentProjectionInspection } from "@shared/assistant-content-part"

export interface CanonicalHydrationFailure {
  attempt: number
  error: unknown
  willRetry: boolean
}

export interface CanonicalHydrationOwner {
  dispose(): void
  request(options?: { resetFailures?: boolean }): Promise<void>
}

interface ContentFocusTarget {
  addEventListener(type: "focus", listener: () => void): void
  removeEventListener(type: "focus", listener: () => void): void
}

interface ContentWindowHydrationOptions {
  batchSize?: number
  inspectCards: (messageIds: string[]) => Promise<AssistantContentProjectionInspection[]>
  onFailure: (failure: CanonicalHydrationFailure) => void
  refreshConcurrency?: number
}

export interface ContentWindowHydrationOwner {
  dispose(): void
  registerCard(input: { messageId: string; refresh: () => Promise<void> }): {
    dispose(): void
    updateProjectionFingerprint(fingerprint: string | null): void
  }
  registerSnapshot(key: string, refresh: () => Promise<void>): () => void
  resync(): Promise<void>
  runAttempt<T>(attempt: () => Promise<T>, signal?: AbortSignal): Promise<T>
  start(target: ContentFocusTarget): () => void
}

interface CanonicalHydrationOptions<T> {
  load: () => Promise<T>
  onFailure: (failure: CanonicalHydrationFailure) => void
  onSuccess: (value: T) => Promise<void> | void
  retryDelaysMs?: readonly number[]
  scheduleRetry?: (callback: () => void, delayMs: number) => () => void
}

const DEFAULT_RETRY_DELAYS_MS = [250, 1_000, 3_000] as const
const DIAGNOSTIC_REPORT_WINDOW_MS = 10_000
const diagnosticReportedAt = new Map<string, number>()

function defaultScheduleRetry(callback: () => void, delayMs: number): () => void {
  const timer = globalThis.setTimeout(callback, delayMs)
  return () => globalThis.clearTimeout(timer)
}

export function createCanonicalHydrationOwner<T>(
  options: CanonicalHydrationOptions<T>
): CanonicalHydrationOwner {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  const scheduleRetry = options.scheduleRetry ?? defaultScheduleRetry
  let active = true
  let cancelRetry: (() => void) | null = null
  let failureCount = 0
  let currentRun: Promise<void> | null = null
  let pending = false
  let resetPendingFailures = false

  const clearRetry = (): void => {
    cancelRetry?.()
    cancelRetry = null
  }

  const run = async (): Promise<void> => {
    try {
      const value = await options.load()
      if (!active) return
      failureCount = 0
      await options.onSuccess(value)
    } catch (error) {
      if (!active) return
      failureCount += 1
      const retryDelayMs = retryDelaysMs[failureCount - 1]
      options.onFailure({
        attempt: failureCount,
        error,
        willRetry: retryDelayMs !== undefined
      })
      if (retryDelayMs !== undefined) {
        cancelRetry = scheduleRetry(() => {
          cancelRetry = null
          void start()
        }, retryDelayMs)
      }
    }
  }

  const start = (): Promise<void> => {
    if (!active) return Promise.resolve()
    if (currentRun) return currentRun
    const execution = run()
    currentRun = execution
    void execution.finally(() => {
      if (currentRun !== execution) return
      currentRun = null
      if (active && pending) {
        pending = false
        if (resetPendingFailures) {
          resetPendingFailures = false
          failureCount = 0
          clearRetry()
        }
        if (!cancelRetry) void start()
      }
    })
    return execution
  }

  return {
    dispose: () => {
      active = false
      pending = false
      clearRetry()
    },
    request: ({ resetFailures = false } = {}) => {
      if (!active) return Promise.resolve()
      if (currentRun) {
        pending = true
        resetPendingFailures ||= resetFailures
        return currentRun
      }
      if (resetFailures) {
        failureCount = 0
        clearRetry()
      } else if (cancelRetry) {
        return Promise.resolve()
      }
      return start()
    }
  }
}

async function runBounded(tasks: readonly (() => Promise<void>)[], maxConcurrency: number) {
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < tasks.length) {
      const task = tasks[cursor]
      cursor += 1
      if (task) await task()
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, tasks.length) }, () => worker()))
}

function createAttemptGate(maxConcurrency: number): {
  dispose(): void
  run<T>(attempt: () => Promise<T>, signal?: AbortSignal): Promise<T>
} {
  let active = 0
  let disposed = false
  const waiters: Array<{
    onAbort: (() => void) | null
    reject: (error: Error) => void
    resolve: () => void
    signal?: AbortSignal
  }> = []
  const cancellationError = (): Error => {
    const error = new Error("Content hydration attempt was cancelled")
    error.name = "AbortError"
    return error
  }
  const cleanupWaiter = (waiter: (typeof waiters)[number]): void => {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort)
    }
  }
  const acquire = async (signal?: AbortSignal): Promise<void> => {
    if (disposed || signal?.aborted) throw cancellationError()
    if (active < maxConcurrency) {
      active += 1
      return
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: (typeof waiters)[number] = {
        onAbort: null,
        reject,
        resolve,
        signal
      }
      if (signal) {
        waiter.onAbort = () => {
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          cleanupWaiter(waiter)
          reject(cancellationError())
        }
        signal.addEventListener("abort", waiter.onAbort, { once: true })
      }
      waiters.push(waiter)
    })
  }
  const release = (): void => {
    while (waiters.length > 0) {
      const waiter = waiters.shift()!
      cleanupWaiter(waiter)
      if (waiter.signal?.aborted) {
        waiter.reject(cancellationError())
        continue
      }
      waiter.resolve()
      return
    }
    active -= 1
  }
  return {
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const waiter of waiters.splice(0)) {
        cleanupWaiter(waiter)
        waiter.reject(cancellationError())
      }
    },
    run: async <T>(attempt: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
      await acquire(signal)
      try {
        if (disposed || signal?.aborted) throw cancellationError()
        return await attempt()
      } finally {
        release()
      }
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value! : fallback
}

export function createContentWindowHydrationOwner(
  options: ContentWindowHydrationOptions
): ContentWindowHydrationOwner {
  const batchSize = positiveInteger(options.batchSize, 50)
  const refreshConcurrency = positiveInteger(options.refreshConcurrency, 2)
  const attemptGate = createAttemptGate(refreshConcurrency)
  const cards = new Map<
    string,
    { projectionFingerprint: string | null; refresh: () => Promise<void> }
  >()
  const snapshots = new Map<string, () => Promise<void>>()
  let disposed = false
  let lifecycleGeneration = 0
  let stopFocus: (() => void) | null = null

  const hydration = createCanonicalHydrationOwner({
    load: async () => {
      await runBounded([...snapshots.values()], refreshConcurrency)
      const registrations = [...cards.entries()]
      const inspections = new Map<string, AssistantContentProjectionInspection>()
      for (let index = 0; index < registrations.length; index += batchSize) {
        const messageIds = registrations
          .slice(index, index + batchSize)
          .map(([messageId]) => messageId)
        for (const inspection of await attemptGate.run(() => options.inspectCards(messageIds))) {
          inspections.set(inspection.messageId, inspection)
        }
      }
      const staleRefreshes = registrations.flatMap(([messageId, registration]) => {
        const inspection = inspections.get(messageId)
        if (
          inspection?.status === "ready" &&
          registration.projectionFingerprint === inspection.projectionFingerprint
        ) {
          return []
        }
        return [registration.refresh]
      })
      await runBounded(staleRefreshes, refreshConcurrency)
    },
    onFailure: options.onFailure,
    onSuccess: () => undefined
  })

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    stopFocus?.()
    stopFocus = null
    cards.clear()
    snapshots.clear()
    hydration.dispose()
    attemptGate.dispose()
  }

  return {
    dispose,
    registerCard: ({ messageId, refresh }) => {
      const registration: {
        projectionFingerprint: string | null
        refresh: () => Promise<void>
      } = { projectionFingerprint: null, refresh }
      cards.set(messageId, registration)
      return {
        dispose: () => {
          if (cards.get(messageId) === registration) cards.delete(messageId)
        },
        updateProjectionFingerprint: (fingerprint) => {
          if (cards.get(messageId) === registration)
            registration.projectionFingerprint = fingerprint
        }
      }
    },
    registerSnapshot: (key, refresh) => {
      snapshots.set(key, refresh)
      return () => {
        if (snapshots.get(key) === refresh) snapshots.delete(key)
      }
    },
    resync: () => hydration.request({ resetFailures: true }),
    runAttempt: (attempt, signal) => attemptGate.run(attempt, signal),
    start: (target) => {
      if (disposed) return () => undefined
      lifecycleGeneration += 1
      stopFocus?.()
      const handleFocus = (): void => {
        void hydration.request({ resetFailures: true })
      }
      target.addEventListener("focus", handleFocus)
      const stop = (): void => target.removeEventListener("focus", handleFocus)
      stopFocus = stop
      return () => {
        if (stopFocus === stop) stopFocus = null
        stop()
        const cleanupGeneration = ++lifecycleGeneration
        queueMicrotask(() => {
          if (!stopFocus && lifecycleGeneration === cleanupGeneration) dispose()
        })
      }
    }
  }
}

export function reportCanonicalContentFailure(input: { operation: string; summary: string }): void {
  const now = Date.now()
  const lastReportedAt = diagnosticReportedAt.get(input.operation) ?? 0
  if (now - lastReportedAt < DIAGNOSTIC_REPORT_WINDOW_MS) return
  diagnosticReportedAt.set(input.operation, now)
  void window.api.diagnostics
    .reportRendererError({
      kind: "error",
      message: input.summary,
      source: `content-sync:${input.operation}`,
      windowKind: document.documentElement.dataset.window ?? "main"
    })
    .catch((error) => {
      console.error("[ContentSync] Failed to report a renderer synchronization error.", error)
    })
}
