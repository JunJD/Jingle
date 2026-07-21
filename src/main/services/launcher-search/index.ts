import type { LauncherSearchResponse, LauncherSearchSource } from "@shared/launcher-search"
import { launcherSearchRequestSchema, type LauncherSearchRequest } from "@shared/launcher-search"
import { JingleIpcError } from "../../ipc/error"
import {
  applicationsLauncherSearchProvider,
  startApplicationIndexRefreshWatcher
} from "./providers/applications"
import { browserHistoryLauncherSearchProvider } from "./providers/browser-history"
import { filesLauncherSearchProvider } from "./providers/files"
import { quicklinksLauncherSearchProvider } from "./providers/quicklinks"
import { threadsLauncherSearchProvider } from "./providers/threads"
import type { LauncherSearchProvider } from "./types"

const defaultProviders: LauncherSearchProvider[] = [
  applicationsLauncherSearchProvider,
  quicklinksLauncherSearchProvider,
  threadsLauncherSearchProvider,
  filesLauncherSearchProvider,
  browserHistoryLauncherSearchProvider
]
const LAUNCHER_SEARCH_CACHE_TTL_MS = 1500
export const LAUNCHER_SEARCH_CACHE_MAX_ENTRIES = 128
export const LAUNCHER_SEARCH_PROVIDER_DEADLINE_MS = 700

interface LauncherSearchResponseCacheOptions {
  maxEntries?: number
  now?: () => number
  ttlMs?: number
}

export class LauncherSearchResponseCache {
  private readonly entries = new Map<
    string,
    { expiresAt: number; response: LauncherSearchResponse }
  >()
  private readonly maxEntries: number
  private readonly now: () => number
  private readonly ttlMs: number

  constructor(options: LauncherSearchResponseCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? LAUNCHER_SEARCH_CACHE_MAX_ENTRIES
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? LAUNCHER_SEARCH_CACHE_TTL_MS
  }

  get size(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  get(cacheKey: string): LauncherSearchResponse | null {
    this.sweepExpired(this.now())
    return this.entries.get(cacheKey)?.response ?? null
  }

  set(cacheKey: string, response: LauncherSearchResponse): void {
    const now = this.now()
    this.sweepExpired(now)
    this.entries.delete(cacheKey)
    this.entries.set(cacheKey, {
      expiresAt: now + this.ttlMs,
      response
    })

    while (this.entries.size > this.maxEntries) {
      const oldestCacheKey = this.entries.keys().next().value
      if (oldestCacheKey === undefined) {
        break
      }
      this.entries.delete(oldestCacheKey)
    }
  }

  private sweepExpired(now: number): void {
    for (const [cacheKey, cached] of this.entries) {
      if (cached.expiresAt <= now) {
        this.entries.delete(cacheKey)
      }
    }
  }
}

interface LauncherSearchCaller {
  reject: (reason: unknown) => void
  resolve: (response: LauncherSearchResponse) => void
}

interface LauncherSearchExecution {
  callers: Map<string, LauncherSearchCaller>
  controller: AbortController
  generation: number
  promise: Promise<LauncherSearchResponse>
}

interface LauncherSearchCoordinatorOptions {
  cache?: LauncherSearchResponseCache
  providerDeadlineMs?: number
  providers?: LauncherSearchProvider[]
}

function dedupeSearchResults<T extends { result: { id: string; source: string } }>(
  entries: T[]
): T[] {
  const seen = new Set<string>()

  return entries.filter((entry) => {
    const key = `${entry.result.source}:${entry.result.id}`
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function getSelectedProviders(
  providers: LauncherSearchProvider[],
  request: LauncherSearchRequest
): LauncherSearchProvider[] {
  if (!request.sources?.length) {
    return providers
  }

  const selectedSources = new Set(request.sources)
  return providers.filter((provider) => selectedSources.has(provider.source))
}

function getSearchRequestCacheKey(request: LauncherSearchRequest): string {
  const sources = request.sources?.length ? request.sources.toSorted().join(",") : "all"
  return JSON.stringify({
    limit: request.limit,
    query: request.query.trim(),
    sources,
    threadMetadataSource: request.threadMetadataSource ?? null
  })
}

function createCancelledError(): JingleIpcError {
  return new JingleIpcError({
    channel: "launcher:search",
    code: "CANCELLED",
    message: "Launcher search was cancelled."
  })
}

function createInvalidatedError(): JingleIpcError {
  return new JingleIpcError({
    channel: "launcher:search",
    code: "UNAVAILABLE",
    message: "Launcher search index changed before the search completed."
  })
}

function createProviderDeadlineError(source: LauncherSearchSource, deadlineMs: number): Error {
  return new Error(`Launcher search provider "${source}" exceeded its ${deadlineMs}ms deadline.`)
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return
  }

  throw signal.reason instanceof Error ? signal.reason : createCancelledError()
}

export class LauncherSearchCoordinator {
  private readonly cache: LauncherSearchResponseCache
  private readonly callers = new Map<string, LauncherSearchExecution>()
  private readonly inflightSearches = new Map<string, LauncherSearchExecution>()
  private readonly providerDeadlineMs: number
  private readonly providerOrder: Map<LauncherSearchSource, number>
  private readonly providers: LauncherSearchProvider[]
  private generation = 0

  constructor(options: LauncherSearchCoordinatorOptions = {}) {
    this.cache = options.cache ?? new LauncherSearchResponseCache()
    this.providerDeadlineMs = Number.isFinite(options.providerDeadlineMs)
      ? Math.max(1, options.providerDeadlineMs!)
      : LAUNCHER_SEARCH_PROVIDER_DEADLINE_MS
    this.providers = options.providers ?? defaultProviders
    this.providerOrder = new Map(this.providers.map((provider, index) => [provider.source, index]))
  }

  async warmup(): Promise<void> {
    const controller = new AbortController()
    await Promise.allSettled(
      this.providers.map((provider) =>
        provider.warmup
          ? this.executeProviderOperation(provider, controller.signal, (signal) =>
              provider.warmup!({ signal })
            )
          : Promise.resolve()
      )
    )
  }

  invalidate(): void {
    this.generation += 1
    this.cache.clear()
    const reason = createInvalidatedError()

    for (const execution of this.inflightSearches.values()) {
      this.settleExecution(execution, { error: reason })
      execution.controller.abort(reason)
    }
    this.inflightSearches.clear()

    for (const provider of this.providers) {
      provider.invalidate?.()
    }
  }

  search(request: LauncherSearchRequest, callerId: string): Promise<LauncherSearchResponse> {
    const normalizedRequest = launcherSearchRequestSchema.parse(request)
    if (this.callers.has(callerId)) {
      throw new JingleIpcError({
        channel: "launcher:search",
        code: "CONFLICT",
        message: "Launcher search caller is already active."
      })
    }

    const cacheKey = getSearchRequestCacheKey(normalizedRequest)
    const cachedResponse = this.cache.get(cacheKey)
    if (cachedResponse) {
      return Promise.resolve(cachedResponse)
    }

    let execution = this.inflightSearches.get(cacheKey)
    if (!execution) {
      execution = this.createExecution(cacheKey, normalizedRequest)
      this.inflightSearches.set(cacheKey, execution)
    }

    return new Promise<LauncherSearchResponse>((resolve, reject) => {
      execution.callers.set(callerId, { reject, resolve })
      this.callers.set(callerId, execution)
    })
  }

  cancel(callerId: string): boolean {
    const execution = this.callers.get(callerId)
    if (!execution) {
      return false
    }

    const caller = execution.callers.get(callerId)
    execution.callers.delete(callerId)
    this.callers.delete(callerId)
    caller?.reject(createCancelledError())

    if (execution.callers.size === 0) {
      for (const [cacheKey, inflight] of this.inflightSearches) {
        if (inflight === execution) {
          this.inflightSearches.delete(cacheKey)
          break
        }
      }
      execution.controller.abort(createCancelledError())
    }

    return true
  }

  private createExecution(
    cacheKey: string,
    request: LauncherSearchRequest
  ): LauncherSearchExecution {
    const controller = new AbortController()
    const execution: LauncherSearchExecution = {
      callers: new Map(),
      controller,
      generation: this.generation,
      promise: Promise.resolve({
        query: request.query,
        results: [],
        terminal: { kind: "complete" }
      })
    }
    execution.promise = this.executeSearch(request, controller.signal)

    void execution.promise
      .then(
        (response) => {
          if (!controller.signal.aborted && this.generation === execution.generation) {
            this.cache.set(cacheKey, response)
          }
          this.settleExecution(execution, { response })
        },
        (error: unknown) => {
          this.settleExecution(execution, { error })
        }
      )
      .finally(() => {
        if (this.inflightSearches.get(cacheKey) === execution) {
          this.inflightSearches.delete(cacheKey)
        }
      })

    return execution
  }

  private settleExecution(
    execution: LauncherSearchExecution,
    outcome: { response: LauncherSearchResponse } | { error: unknown }
  ): void {
    for (const [callerId, caller] of execution.callers) {
      this.callers.delete(callerId)
      if ("response" in outcome) {
        caller.resolve(outcome.response)
      } else {
        caller.reject(outcome.error)
      }
    }
    execution.callers.clear()
  }

  private async executeSearch(
    request: LauncherSearchRequest,
    signal: AbortSignal
  ): Promise<LauncherSearchResponse> {
    throwIfAborted(signal)
    const selectedProviders = getSelectedProviders(this.providers, request)

    if (selectedProviders.length === 0) {
      return {
        query: request.query,
        results: [],
        terminal: { kind: "complete" }
      }
    }

    const providerResponses = await Promise.allSettled(
      selectedProviders.map((provider) =>
        this.executeProviderOperation(provider, signal, (providerSignal) =>
          provider.search(request, { signal: providerSignal })
        )
      )
    )
    throwIfAborted(signal)

    const partialSources: LauncherSearchSource[] = []
    const unavailableSources: LauncherSearchSource[] = []
    const sortedEntries = providerResponses
      .flatMap((providerResponse, providerResponseIndex) => {
        const provider = selectedProviders[providerResponseIndex]
        if (!provider) {
          return []
        }

        if (providerResponse.status === "rejected") {
          unavailableSources.push(provider.source)
          console.warn(`[LauncherSearch] Provider "${provider.source}" failed:`, {
            error:
              providerResponse.reason instanceof Error
                ? providerResponse.reason.message
                : String(providerResponse.reason)
          })
          return []
        }

        if (providerResponse.value.kind === "partial") {
          partialSources.push(provider.source)
        }

        return providerResponse.value.results.map((result, resultIndex) => ({
          providerResponseIndex,
          result,
          resultIndex
        }))
      })
      .sort((left, right) => {
        if (right.result.score !== left.result.score) {
          return right.result.score - left.result.score
        }

        const leftOrder = this.providerOrder.get(left.result.source) ?? Number.MAX_SAFE_INTEGER
        const rightOrder = this.providerOrder.get(right.result.source) ?? Number.MAX_SAFE_INTEGER
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder
        }

        if (left.providerResponseIndex !== right.providerResponseIndex) {
          return left.providerResponseIndex - right.providerResponseIndex
        }

        return left.resultIndex - right.resultIndex
      })
    const results = dedupeSearchResults(sortedEntries)
      .slice(0, request.limit)
      .map((entry) => entry.result)

    return {
      query: request.query,
      results,
      terminal:
        partialSources.length === 0 && unavailableSources.length === 0
          ? { kind: "complete" }
          : {
              kind: "partial",
              partialSources,
              unavailableSources
            }
    }
  }

  private executeProviderOperation<T>(
    provider: LauncherSearchProvider,
    parentSignal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    throwIfAborted(parentSignal)
    const controller = new AbortController()

    return new Promise<T>((resolve, reject) => {
      let settled = false
      const settle = (next: () => void): void => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(deadline)
        parentSignal.removeEventListener("abort", handleParentAbort)
        next()
      }
      const handleParentAbort = (): void => {
        const reason =
          parentSignal.reason instanceof Error ? parentSignal.reason : createCancelledError()
        controller.abort(reason)
        settle(() => reject(reason))
      }
      const deadline = setTimeout(() => {
        const reason = createProviderDeadlineError(provider.source, this.providerDeadlineMs)
        controller.abort(reason)
        settle(() => reject(reason))
      }, this.providerDeadlineMs)

      parentSignal.addEventListener("abort", handleParentAbort, { once: true })
      let operationPromise: Promise<T>
      try {
        operationPromise = operation(controller.signal)
      } catch (error) {
        settle(() => reject(error))
        return
      }

      void operationPromise.then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error))
      )
    })
  }
}

const launcherSearchCoordinator = new LauncherSearchCoordinator()

export async function warmLauncherSearchProviders(): Promise<void> {
  await launcherSearchCoordinator.warmup()
}

export function invalidateLauncherSearch(): void {
  launcherSearchCoordinator.invalidate()
}

export function startLauncherSearchIndexRefresh(
  params: { onRefresh?: () => void } = {}
): () => void {
  return startApplicationIndexRefreshWatcher(() => {
    invalidateLauncherSearch()
    params.onRefresh?.()
  })
}

export function searchLauncher(
  request: LauncherSearchRequest,
  callerId: string
): Promise<LauncherSearchResponse> {
  return launcherSearchCoordinator.search(request, callerId)
}

export function cancelLauncherSearch(callerId: string): boolean {
  return launcherSearchCoordinator.cancel(callerId)
}
