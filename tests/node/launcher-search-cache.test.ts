import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import type { LauncherSearchResponse } from "../../src/shared/launcher-search"

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
    results: []
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
