import assert from "node:assert/strict"
import test from "node:test"
import { Cache, ExtensionRuntimeRequestError, LocalStorage } from "@jingle/extension-api"
import {
  createExtensionRuntimeNavigation,
  encodeRuntimeCacheBackendScopeKey,
  installExtensionRuntimeCacheBackend,
  runWithExtensionRuntimeSdk,
  type ExtensionRuntimeHostRequestInput,
  type RuntimeCacheBackend,
  type RuntimeCacheBackendScope,
  type RuntimeCacheEntry
} from "@jingle/extension-api/host-runtime"
import type {
  ExtensionHostResponse,
  ExtensionRuntimeDataIdentityState,
  ExtensionRuntimeLaunchContext
} from "../../src/shared/extension-runtime-protocol"

const CACHE_REVISION_IDENTITY = {
  commandConfigGeneration: 5,
  connectionConfigGeneration: 4,
  extensionConfigGeneration: 2,
  kind: "available" as const,
  runtimeArtifactRevision: "1.2.3",
  runtimePackageRevision: "1.2.3"
}

const LOCAL_STORAGE_IDENTITY = {
  connectionId: "workspace",
  credentialGeneration: 3
}

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

test("LocalStorage preserves typed runtime request error codes", async () => {
  const requests: ExtensionRuntimeHostRequestInput[] = []
  const requestHost = async (
    request: ExtensionRuntimeHostRequestInput
  ): Promise<ExtensionHostResponse> => {
    requests.push(request)
    return {
      error: {
        code: "storage_legacy_unowned",
        details: {
          keys: ["recentPage"],
          kind: "storage-legacy-unowned",
          scope: "extension"
        },
        message: "Legacy LocalStorage key has no typed owner."
      },
      id: "storage-error",
      ok: false
    }
  }
  const navigation = createExtensionRuntimeNavigation({ requestHost })

  await runWithExtensionRuntimeSdk(
    {
      ...createLaunchContext(),
      navigation,
      requestHost
    },
    async () => {
      const operations: Array<() => Promise<unknown>> = [
        () => LocalStorage.getItem("recentPage"),
        () => LocalStorage.setItem("recentPage", "page-2"),
        () => LocalStorage.allItems(),
        () => LocalStorage.removeItem("recentPage"),
        () => LocalStorage.clear()
      ]

      for (const operation of operations) {
        await assert.rejects(operation, (error) => {
          assert.ok(error instanceof ExtensionRuntimeRequestError)
          assert.equal(error.name, "ExtensionRuntimeRequestError")
          assert.equal(error.code, "storage_legacy_unowned")
          assert.equal(error.message, "Legacy LocalStorage key has no typed owner.")
          assert.deepEqual(error.details, {
            keys: ["recentPage"],
            kind: "storage-legacy-unowned",
            scope: "extension"
          })
          assert.equal(Object.isFrozen(error.details), true)
          assert.equal(Object.isFrozen(error.details?.keys), true)
          return true
        })
      }
    }
  )

  assert.deepEqual(
    requests.map((request) => request.method),
    ["get", "set", "all-items", "remove", "clear"]
  )
})

test("LocalStorage fails closed when typed recovery details are missing", async () => {
  const requestHost = async (): Promise<ExtensionHostResponse> => ({
    error: {
      code: "storage_legacy_unowned",
      message: "Legacy LocalStorage key has no typed owner."
    },
    id: "storage-error",
    ok: false
  })
  const navigation = createExtensionRuntimeNavigation({ requestHost })

  await runWithExtensionRuntimeSdk(
    {
      ...createLaunchContext(),
      navigation,
      requestHost
    },
    async () => {
      await assert.rejects(
        () => LocalStorage.allItems(),
        (error) => {
          assert.ok(error instanceof ExtensionRuntimeRequestError)
          assert.equal(error.code, "runtime_response_invalid")
          assert.equal(error.details, undefined)
          return true
        }
      )
    }
  )
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
      return savedStores.get(encodeRuntimeCacheBackendScopeKey(scope)) ?? []
    },
    saveStore(scope, entries) {
      savedStores.set(encodeRuntimeCacheBackendScopeKey(scope), [...entries])
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

    const notionScope = createCacheScope("notion", "recent-pages")
    const githubScope = createCacheScope("github", "recent-pages")
    assert.deepEqual(savedStores.get(encodeRuntimeCacheBackendScopeKey(notionScope)), [
      ["page", "page-1"]
    ])
    assert.deepEqual(savedStores.get(encodeRuntimeCacheBackendScopeKey(githubScope)), [
      ["page", "issue-1"]
    ])
    assert.deepEqual(loads, [notionScope, githubScope])
  } finally {
    uninstallBackend()
  }

  assert.deepEqual(requests, [])
})

test("Cache resolves backend connection identity from the wire LocalStorage owner", async () => {
  const loadedScopes: RuntimeCacheBackendScope[] = []
  const backend: RuntimeCacheBackend = {
    loadStore(scope) {
      loadedScopes.push(scope)
      return []
    },
    saveStore: () => undefined
  }
  const uninstallBackend = installExtensionRuntimeCacheBackend(backend)
  const dataIdentity = createAvailableDataIdentity(
    {},
    { connectionId: "personal", credentialGeneration: 9 }
  )

  try {
    if (dataIdentity.kind !== "available" || dataIdentity.cache.kind !== "available") {
      throw new Error("Expected available test data identity")
    }
    assert.equal(Object.hasOwn(dataIdentity.cache, "connectionId"), false)
    assert.equal(Object.hasOwn(dataIdentity.cache, "credentialGeneration"), false)

    await runWithCacheContext(async () => {
      assert.equal(new Cache({ namespace: "local-storage-owner-test" }).has("page"), false)
    }, dataIdentity)
  } finally {
    uninstallBackend()
  }

  assert.deepEqual(loadedScopes, [
    {
      commandName: "search-page",
      extensionName: "notion",
      identity: {
        ...CACHE_REVISION_IDENTITY,
        connectionId: "personal",
        credentialGeneration: 9
      },
      namespace: "local-storage-owner-test"
    }
  ])
})

test("cache backend scope codec is canonical and isolates every address field", () => {
  const scope = createCacheScope("notion", "recent-pages")
  const equivalentScope: RuntimeCacheBackendScope = {
    namespace: scope.namespace,
    identity: {
      runtimePackageRevision: scope.identity.runtimePackageRevision,
      runtimeArtifactRevision: scope.identity.runtimeArtifactRevision,
      kind: "available",
      extensionConfigGeneration: scope.identity.extensionConfigGeneration,
      credentialGeneration: scope.identity.credentialGeneration,
      connectionId: scope.identity.connectionId,
      connectionConfigGeneration: scope.identity.connectionConfigGeneration,
      commandConfigGeneration: scope.identity.commandConfigGeneration
    },
    extensionName: scope.extensionName,
    commandName: scope.commandName
  }
  const baseKey = encodeRuntimeCacheBackendScopeKey(scope)

  assert.equal(encodeRuntimeCacheBackendScopeKey(equivalentScope), baseKey)

  const variants: RuntimeCacheBackendScope[] = [
    { ...scope, extensionName: "github" },
    { ...scope, commandName: "notifications" },
    {
      ...scope,
      identity: { ...scope.identity, connectionId: "personal" }
    },
    {
      ...scope,
      identity: { ...scope.identity, credentialGeneration: 4 }
    },
    {
      ...scope,
      identity: { ...scope.identity, connectionConfigGeneration: 5 }
    },
    {
      ...scope,
      identity: { ...scope.identity, extensionConfigGeneration: 3 }
    },
    {
      ...scope,
      identity: { ...scope.identity, commandConfigGeneration: 6 }
    },
    {
      ...scope,
      identity: { ...scope.identity, runtimePackageRevision: "1.2.4" }
    },
    {
      ...scope,
      identity: { ...scope.identity, runtimeArtifactRevision: "artifact-2" }
    },
    { ...scope, namespace: "other" }
  ]

  assert.equal(new Set([baseKey, ...variants.map(encodeRuntimeCacheBackendScopeKey)]).size, 11)
})

test("Cache evicts least-recently-used entries by byte capacity", async () => {
  await runWithCacheContext(async () => {
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
})

test("Cache rejects missing and unavailable runtime identities", async () => {
  assert.throws(
    () => new Cache({ namespace: "missing-context" }).has("page"),
    /SDK is not initialized/
  )

  await assert.rejects(
    runWithCacheContext(async () => new Cache({ namespace: "missing-data" }).has("page"), {
      kind: "unavailable"
    }),
    /requires an available data identity/
  )
  await assert.rejects(
    runWithCacheContext(async () => new Cache({ namespace: "missing-artifact" }).has("page"), {
      cache: {
        kind: "unavailable",
        reason: "artifact-revision-unavailable"
      },
      kind: "available",
      localStorage: {
        connectionId: "workspace",
        credentialGeneration: 3
      }
    }),
    /artifact-revision-unavailable/
  )
})

test("Cache scopes entries by command and every available identity fact", async () => {
  const savedStores = new Map<string, RuntimeCacheEntry[]>()
  const loadedScopes = new Set<string>()
  const backend: RuntimeCacheBackend = {
    loadStore: (scope) => {
      loadedScopes.add(encodeRuntimeCacheBackendScopeKey(scope))
      return savedStores.get(encodeRuntimeCacheBackendScopeKey(scope)) ?? []
    },
    saveStore: (scope, entries) =>
      savedStores.set(encodeRuntimeCacheBackendScopeKey(scope), [...entries])
  }
  const uninstallBackend = installExtensionRuntimeCacheBackend(backend)
  try {
    await runWithCacheContext(async () => {
      new Cache({ namespace: "identity" }).set("page", "base")
    })
    for (const dataIdentity of [
      createAvailableDataIdentity({ commandConfigGeneration: 6 }),
      createAvailableDataIdentity({ connectionConfigGeneration: 5 }),
      createAvailableDataIdentity({}, { connectionId: "personal" }),
      createAvailableDataIdentity({}, { credentialGeneration: 4 }),
      createAvailableDataIdentity({ extensionConfigGeneration: 9 }),
      createAvailableDataIdentity({ runtimeArtifactRevision: "1.2.4" }),
      createAvailableDataIdentity({ runtimePackageRevision: "1.2.4" })
    ]) {
      await runWithCacheContext(async () => {
        assert.equal(new Cache({ namespace: "identity" }).get("page"), undefined)
      }, dataIdentity)
    }
    await runWithCacheContext(
      async () => {
        assert.equal(new Cache({ namespace: "identity" }).get("page"), undefined)
      },
      createAvailableDataIdentity(),
      "other-command"
    )
  } finally {
    uninstallBackend()
  }
  assert.equal(savedStores.size, 1)
  assert.equal(loadedScopes.size, 9)
})

test("Cache persists read recency to the installed backend", async () => {
  const savedStores = new Map<string, RuntimeCacheEntry[]>()
  const backend: RuntimeCacheBackend = {
    loadStore(scope) {
      return savedStores.get(encodeRuntimeCacheBackendScopeKey(scope)) ?? []
    },
    saveStore(scope, entries) {
      savedStores.set(encodeRuntimeCacheBackendScopeKey(scope), [...entries])
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
    dataIdentity: {
      cache: {
        ...CACHE_REVISION_IDENTITY
      },
      kind: "available",
      localStorage: {
        ...LOCAL_STORAGE_IDENTITY
      }
    },
    extensionName: "notion",
    extensionPreferences: {},
    initialAction: "open",
    locale: "zh-CN",
    mode: "view",
    seedQuery: ""
  }
}

function createAvailableDataIdentity(
  cacheOverrides: Partial<typeof CACHE_REVISION_IDENTITY> = {},
  localStorageOverrides: Partial<typeof LOCAL_STORAGE_IDENTITY> = {}
): ExtensionRuntimeDataIdentityState {
  return {
    cache: { ...CACHE_REVISION_IDENTITY, ...cacheOverrides },
    kind: "available",
    localStorage: {
      ...LOCAL_STORAGE_IDENTITY,
      ...localStorageOverrides
    }
  }
}

async function runWithCacheContext<T>(
  callback: () => Promise<T> | T,
  dataIdentity: ExtensionRuntimeDataIdentityState = createAvailableDataIdentity(),
  commandName = "search-page"
): Promise<T> {
  const requestHost = async (): Promise<ExtensionHostResponse> => ({
    id: "cache-context",
    ok: true,
    result: null
  })
  return runWithExtensionRuntimeSdk(
    {
      ...createLaunchContext(),
      commandName,
      dataIdentity,
      navigation: createExtensionRuntimeNavigation({ requestHost }),
      requestHost
    },
    callback
  )
}

function createCacheScope(extensionName: string, namespace: string): RuntimeCacheBackendScope {
  return {
    commandName: "search-page",
    extensionName,
    identity: {
      ...LOCAL_STORAGE_IDENTITY,
      ...CACHE_REVISION_IDENTITY
    },
    namespace
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
