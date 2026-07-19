import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import type { LauncherSearchResponse } from "../../src/shared/launcher-search"
import type {
  LauncherSearchProvider,
  LauncherSearchProviderResponse
} from "../../src/main/services/launcher-search/types"

const requireFromTest = createRequire(import.meta.url)

function installElectronModuleMock(): void {
  const originalOverridePath = process.env.ELECTRON_OVERRIDE_DIST_PATH
  process.env.ELECTRON_OVERRIDE_DIST_PATH = process.cwd()

  try {
    const electronModuleId = requireFromTest.resolve("electron")
    requireFromTest("electron")
    const electronModule = requireFromTest.cache[electronModuleId]
    assert.ok(electronModule, "Expected electron module to be loaded before mocking it.")
    electronModule.exports = {
      app: {},
      nativeImage: {},
      shell: {}
    }
  } finally {
    if (originalOverridePath === undefined) {
      delete process.env.ELECTRON_OVERRIDE_DIST_PATH
    } else {
      process.env.ELECTRON_OVERRIDE_DIST_PATH = originalOverridePath
    }
  }
}

installElectronModuleMock()

const cacheModulePromise = import("../../src/main/services/launcher-search")

function createResponse(query: string): LauncherSearchResponse {
  return {
    query,
    results: [],
    terminal: { kind: "complete" }
  }
}

function createDeferred<T>(): {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T) => void
} {
  let rejectPromise!: (reason?: unknown) => void
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject
    resolvePromise = resolve
  })
  return { promise, reject: rejectPromise, resolve: resolvePromise }
}

function createProviderResponse(title?: string): LauncherSearchProviderResponse {
  return {
    kind: "complete",
    results: title
      ? [
          {
            action: { executor: "internal", target: null, type: "none" },
            id: title,
            kind: "application",
            score: 100,
            source: "applications",
            subtitle: title,
            title
          }
        ]
      : []
  }
}

test("launcher search cache bounds unique source and query keys and sweeps expired entries", async () => {
  const { LAUNCHER_SEARCH_CACHE_MAX_ENTRIES, LauncherSearchResponseCache } =
    await cacheModulePromise
  let now = 10_000
  const cache = new LauncherSearchResponseCache({ now: () => now })

  for (let index = 0; index < 1_000; index += 1) {
    cache.set(`applications:query-${index}`, createResponse(`query-${index}`))
  }

  assert.equal(cache.size, LAUNCHER_SEARCH_CACHE_MAX_ENTRIES)

  now += 1_500
  cache.set("applications:current", createResponse("current"))

  assert.equal(cache.size, 1)
})

test("launcher search cache preserves live entries and same-key hits without extending TTL", async () => {
  const { LauncherSearchResponseCache } = await cacheModulePromise
  let now = 20_000
  const cache = new LauncherSearchResponseCache({ now: () => now })
  const response = createResponse("jingle")

  cache.set("applications:jingle", response)
  now += 1_499

  assert.strictEqual(cache.get("applications:jingle"), response)
  assert.equal(cache.size, 1)

  now += 1

  assert.equal(cache.get("applications:jingle"), null)
  assert.equal(cache.size, 0)
})

test("launcher search cache evicts the oldest live entry at capacity", async () => {
  const { LAUNCHER_SEARCH_CACHE_MAX_ENTRIES, LauncherSearchResponseCache } =
    await cacheModulePromise
  const cache = new LauncherSearchResponseCache({ now: () => 30_000 })
  const firstResponse = createResponse("first")
  const lastResponse = createResponse("last")

  cache.set("threads:first", firstResponse)
  for (let index = 1; index < LAUNCHER_SEARCH_CACHE_MAX_ENTRIES; index += 1) {
    cache.set(`threads:query-${index}`, createResponse(`query-${index}`))
  }
  cache.set("threads:last", lastResponse)

  assert.equal(cache.size, LAUNCHER_SEARCH_CACHE_MAX_ENTRIES)
  assert.equal(cache.get("threads:first"), null)
  assert.strictEqual(cache.get("threads:last"), lastResponse)
})

test("launcher search cache clear preserves invalidation ownership", async () => {
  const { LauncherSearchResponseCache } = await cacheModulePromise
  const cache = new LauncherSearchResponseCache()

  cache.set("files:jingle", createResponse("jingle"))
  cache.clear()

  assert.equal(cache.size, 0)
  assert.equal(cache.get("files:jingle"), null)
})

test("launcher search coordinator shares one execution while callers retain independent cancellation", async () => {
  const { LauncherSearchCoordinator } = await cacheModulePromise
  const deferred = createDeferred<LauncherSearchProviderResponse>()
  let executionCount = 0
  const providerSignals: AbortSignal[] = []
  const provider: LauncherSearchProvider = {
    search: async (_request, context) => {
      executionCount += 1
      providerSignals.push(context.signal)
      return deferred.promise
    },
    source: "applications"
  }
  const coordinator = new LauncherSearchCoordinator({
    providerDeadlineMs: 60_000,
    providers: [provider]
  })
  const request = { limit: 10, query: "jingle", sources: ["applications" as const] }
  const first = coordinator.search(request, "caller-1")
  const second = coordinator.search(request, "caller-2")
  const firstCancellation = assert.rejects(
    first,
    (error: Error & { code?: string }) => error.code === "CANCELLED"
  )

  assert.equal(coordinator.cancel("caller-1"), true)
  await firstCancellation
  assert.equal(providerSignals[0]?.aborted, false)

  deferred.resolve(createProviderResponse("Jingle"))
  assert.equal((await second).results[0]?.title, "Jingle")
  assert.equal(executionCount, 1)

  assert.equal((await coordinator.search(request, "caller-3")).results[0]?.title, "Jingle")
  assert.equal(executionCount, 1)
})

test("last caller cancellation aborts work and an old execution cannot erase or cache over its successor", async () => {
  const { LauncherSearchCoordinator } = await cacheModulePromise
  const deferredExecutions: Array<
    ReturnType<typeof createDeferred<LauncherSearchProviderResponse>>
  > = []
  const signals: AbortSignal[] = []
  const provider: LauncherSearchProvider = {
    search: async (_request, context) => {
      signals.push(context.signal)
      const deferred = createDeferred<LauncherSearchProviderResponse>()
      deferredExecutions.push(deferred)
      return deferred.promise
    },
    source: "applications"
  }
  const coordinator = new LauncherSearchCoordinator({
    providerDeadlineMs: 60_000,
    providers: [provider]
  })
  const request = { limit: 10, query: "jingle", sources: ["applications" as const] }
  const oldSearch = coordinator.search(request, "old-caller")
  const oldCancellation = assert.rejects(
    oldSearch,
    (error: Error & { code?: string }) => error.code === "CANCELLED"
  )

  coordinator.cancel("old-caller")
  await oldCancellation
  assert.equal(signals[0]?.aborted, true)

  const newSearch = coordinator.search(request, "new-caller")
  deferredExecutions[1]?.resolve(createProviderResponse("New"))
  assert.equal((await newSearch).results[0]?.title, "New")

  deferredExecutions[0]?.resolve(createProviderResponse("Old"))
  await Promise.resolve()
  assert.equal((await coordinator.search(request, "cached-caller")).results[0]?.title, "New")
  assert.equal(deferredExecutions.length, 2)
})

test("launcher search invalidation rejects current callers and isolates the replacement generation", async () => {
  const { LauncherSearchCoordinator } = await cacheModulePromise
  const deferredExecutions: Array<
    ReturnType<typeof createDeferred<LauncherSearchProviderResponse>>
  > = []
  const signals: AbortSignal[] = []
  const provider: LauncherSearchProvider = {
    search: async (_request, context) => {
      signals.push(context.signal)
      const deferred = createDeferred<LauncherSearchProviderResponse>()
      deferredExecutions.push(deferred)
      return deferred.promise
    },
    source: "applications"
  }
  const coordinator = new LauncherSearchCoordinator({
    providerDeadlineMs: 60_000,
    providers: [provider]
  })
  const request = { limit: 10, query: "jingle", sources: ["applications" as const] }
  const staleSearch = coordinator.search(request, "stale-caller")
  const invalidated = assert.rejects(
    staleSearch,
    (error: Error & { code?: string }) => error.code === "UNAVAILABLE"
  )

  coordinator.invalidate()
  await invalidated
  assert.equal(signals[0]?.aborted, true)

  const freshSearch = coordinator.search(request, "fresh-caller")
  deferredExecutions[1]?.resolve(createProviderResponse("Fresh"))
  assert.equal((await freshSearch).results[0]?.title, "Fresh")
})

test("launcher search exposes provider failure and operational partial completion as typed terminal facts", async () => {
  const { LauncherSearchCoordinator } = await cacheModulePromise
  const unavailableProvider: LauncherSearchProvider = {
    search: async () => {
      throw new Error("provider unavailable")
    },
    source: "applications"
  }
  const partialProvider: LauncherSearchProvider = {
    search: async () => ({ kind: "partial", results: [] }),
    source: "files"
  }
  const coordinator = new LauncherSearchCoordinator({
    providers: [unavailableProvider, partialProvider]
  })

  const response = await coordinator.search({ limit: 10, query: "jingle" }, "caller")
  assert.deepEqual(response.terminal, {
    kind: "partial",
    partialSources: ["files"],
    unavailableSources: ["applications"]
  })
})

test("launcher search deadline aborts a stalled provider and returns a typed unavailable terminal", async () => {
  const { LauncherSearchCoordinator } = await cacheModulePromise
  const stalledSignals: AbortSignal[] = []
  const coordinator = new LauncherSearchCoordinator({
    providerDeadlineMs: 10,
    providers: [
      {
        search: async () => ({
          kind: "complete" as const,
          results: createProviderResponse("ready").results
        }),
        source: "applications"
      },
      {
        search: (_request, context) => {
          stalledSignals.push(context.signal)
          return new Promise<LauncherSearchProviderResponse>(() => undefined)
        },
        source: "threads"
      }
    ]
  })

  const response = await coordinator.search(
    { limit: 10, query: "deadline", sources: ["applications", "threads"] },
    "deadline-caller"
  )

  assert.deepEqual(
    response.results.map((result) => result.id),
    ["ready"]
  )
  assert.deepEqual(response.terminal, {
    kind: "partial",
    partialSources: [],
    unavailableSources: ["threads"]
  })
  assert.equal(stalledSignals[0]?.aborted, true)
})
