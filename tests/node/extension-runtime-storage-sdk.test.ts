import assert from "node:assert/strict"
import test from "node:test"
import { Cache, LocalStorage } from "@openwork/extension-api"
import {
  createExtensionRuntimeNavigation,
  installExtensionRuntimeCacheBackend,
  runWithExtensionRuntimeSdk,
  type ExtensionRuntimeHostRequestInput,
  type RuntimeCacheBackend,
  type RuntimeCacheBackendScope,
  type RuntimeCacheEntry
} from "@openwork/extension-api/host-runtime"
import type {
  ExtensionHostResponse,
  ExtensionRuntimeLaunchContext
} from "../../src/shared/extension-runtime-protocol"

test("LocalStorage uses extension-scoped runtime storage host requests", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const responses = [
    "stored page",
    null,
    {
      recentPage: "page-1"
    },
    null,
    null
  ]
  const navigation = createExtensionRuntimeNavigation({
    requestHost: async (request) => resolveRuntimeRequest(request, requests, responses)
  })

  await runWithExtensionRuntimeSdk(
    {
      ...createLaunchContext(),
      navigation,
      requestHost: async (request) => resolveRuntimeRequest(request, requests, responses)
    },
    async () => {
      assert.equal(await LocalStorage.getItem<string>("recentPage"), "stored page")
      await LocalStorage.setItem("recentPage", "page-2")
      assert.deepEqual(await LocalStorage.allItems(), {
        recentPage: "page-1"
      })
      await LocalStorage.removeItem("recentPage")
      await LocalStorage.clear()
    }
  )

  assert.deepEqual(requests, [
    {
      capability: "storage",
      method: "get",
      payload: {
        key: "recentPage",
        scope: "extension"
      }
    },
    {
      capability: "storage",
      method: "set",
      payload: {
        key: "recentPage",
        scope: "extension",
        value: "page-2"
      }
    },
    {
      capability: "storage",
      method: "all-items",
      payload: {
        scope: "extension"
      }
    },
    {
      capability: "storage",
      method: "remove",
      payload: {
        key: "recentPage",
        scope: "extension"
      }
    },
    {
      capability: "storage",
      method: "clear",
      payload: {
        scope: "extension"
      }
    }
  ])
})

test("Cache provides synchronous namespaced in-memory string storage", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const navigation = createExtensionRuntimeNavigation({
    requestHost: async (request) => resolveRuntimeRequest(request, requests, [])
  })

  await runWithExtensionRuntimeSdk(
    {
      ...createLaunchContext(),
      navigation,
      requestHost: async (request) => resolveRuntimeRequest(request, requests, [])
    },
    async () => {
      const cache = new Cache({ namespace: "cache-test" })
      const sameNamespace = new Cache({ namespace: "cache-test" })
      const otherNamespace = new Cache({ namespace: "cache-test-other" })
      const events: Array<{ data?: string; key?: string }> = []
      const unsubscribe = cache.subscribe((key, data) => events.push({ data, key }))

      cache.clear({ notifySubscribers: false })
      otherNamespace.clear({ notifySubscribers: false })
      assert.equal(cache.isEmpty, true)

      cache.set("recentPage", "page-1")
      assert.equal(cache.has("recentPage"), true)
      assert.equal(sameNamespace.get("recentPage"), "page-1")
      assert.equal(otherNamespace.get("recentPage"), undefined)

      assert.equal(cache.remove("recentPage"), true)
      assert.equal(cache.remove("recentPage"), false)
      cache.set("a", "1")
      cache.clear()
      unsubscribe()

      assert.deepEqual(events, [
        { data: "page-1", key: "recentPage" },
        { data: undefined, key: "recentPage" },
        { data: "1", key: "a" },
        { data: undefined, key: undefined }
      ])
    }
  )

  assert.deepEqual(requests, [])
})

test("Cache uses extension-scoped runtime backend when installed", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const savedStores = new Map<string, RuntimeCacheEntry[]>()
  const loads: RuntimeCacheBackendScope[] = []
  const backend: RuntimeCacheBackend = {
    loadStore(scope) {
      loads.push(scope)
      return savedStores.get(getScopeKey(scope)) ?? []
    },
    saveStore(scope, entries) {
      savedStores.set(getScopeKey(scope), [...entries])
    }
  }
  const uninstallBackend = installExtensionRuntimeCacheBackend(backend)
  const navigation = createExtensionRuntimeNavigation({
    requestHost: async (request) => resolveRuntimeRequest(request, requests, [])
  })

  try {
    await runWithExtensionRuntimeSdk(
      {
        ...createLaunchContext(),
        extensionName: "notion",
        navigation,
        requestHost: async (request) => resolveRuntimeRequest(request, requests, [])
      },
      async () => {
        const cache = new Cache({ namespace: "recent-pages" })
        cache.clear({ notifySubscribers: false })
        cache.set("page", "page-1")
      }
    )
    await runWithExtensionRuntimeSdk(
      {
        ...createLaunchContext(),
        extensionName: "github",
        navigation,
        requestHost: async (request) => resolveRuntimeRequest(request, requests, [])
      },
      async () => {
        const cache = new Cache({ namespace: "recent-pages" })
        assert.equal(cache.get("page"), undefined)
        cache.set("page", "issue-1")
      }
    )

    assert.deepEqual(
      savedStores.get(getScopeKey({ extensionName: "notion", namespace: "recent-pages" })),
      [["page", "page-1"]]
    )
    assert.deepEqual(
      savedStores.get(getScopeKey({ extensionName: "github", namespace: "recent-pages" })),
      [["page", "issue-1"]]
    )
    assert.deepEqual(loads, [
      { extensionName: "notion", namespace: "recent-pages" },
      { extensionName: "github", namespace: "recent-pages" }
    ])
  } finally {
    uninstallBackend()
  }

  assert.deepEqual(requests, [])
})

test("Cache evicts least-recently-used entries by byte capacity", () => {
  const cache = new Cache({ capacity: 10, namespace: "cache-capacity-test" })
  const events: Array<{ data?: string; key?: string }> = []
  cache.clear({ notifySubscribers: false })
  const unsubscribe = cache.subscribe((key, data) => events.push({ data, key }))

  cache.set("a", "1234")
  cache.set("b", "1234")
  assert.equal(cache.get("a"), "1234")

  cache.set("c", "1234")
  assert.equal(cache.has("b"), false)
  assert.equal(cache.get("a"), "1234")
  assert.equal(cache.get("c"), "1234")
  unsubscribe()

  assert.deepEqual(events, [
    { data: "1234", key: "a" },
    { data: "1234", key: "b" },
    { data: "1234", key: "c" },
    { data: undefined, key: "b" }
  ])
})

test("Cache persists read recency to the installed backend", async () => {
  const savedStores = new Map<string, RuntimeCacheEntry[]>()
  const backend: RuntimeCacheBackend = {
    loadStore(scope) {
      return savedStores.get(getScopeKey(scope)) ?? []
    },
    saveStore(scope, entries) {
      savedStores.set(getScopeKey(scope), [...entries])
    }
  }
  let uninstallBackend = installExtensionRuntimeCacheBackend(backend)
  const navigation = createExtensionRuntimeNavigation({
    requestHost: async (request) => resolveRuntimeRequest(request, [], [])
  })

  try {
    await runWithExtensionRuntimeSdk(
      {
        ...createLaunchContext(),
        navigation,
        requestHost: async (request) => resolveRuntimeRequest(request, [], [])
      },
      async () => {
        const cache = new Cache({ capacity: 10, namespace: "persistent-lru-test" })
        cache.clear({ notifySubscribers: false })
        cache.set("a", "1234")
        cache.set("b", "1234")
        assert.equal(cache.get("a"), "1234")
      }
    )

    uninstallBackend()
    uninstallBackend = installExtensionRuntimeCacheBackend(backend)

    await runWithExtensionRuntimeSdk(
      {
        ...createLaunchContext(),
        navigation,
        requestHost: async (request) => resolveRuntimeRequest(request, [], [])
      },
      async () => {
        const cache = new Cache({ capacity: 10, namespace: "persistent-lru-test" })
        cache.set("c", "1234")
        assert.equal(cache.has("b"), false)
        assert.equal(cache.get("a"), "1234")
        assert.equal(cache.get("c"), "1234")
      }
    )
  } finally {
    uninstallBackend()
  }
})

function createLaunchContext(): ExtensionRuntimeLaunchContext {
  return {
    commandName: "search-page",
    commandPreferences: {},
    extensionName: "notion",
    extensionPreferences: {},
    initialAction: "open",
    locale: "zh-CN",
    mode: "view",
    seedQuery: ""
  }
}

function resolveRuntimeRequest(
  request: ExtensionRuntimeHostRequestInput,
  requests: ExtensionRuntimeHostRequestInput[],
  responses: unknown[]
): ExtensionHostResponse {
  requests.push(request)
  return {
    id: "test-host-request",
    ok: true,
    result: responses.shift()
  }
}

function getScopeKey(scope: RuntimeCacheBackendScope): string {
  return JSON.stringify([scope.extensionName, scope.namespace])
}
