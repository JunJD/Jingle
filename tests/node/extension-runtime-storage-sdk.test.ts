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
  type RuntimeCacheBackendMutation,
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
    ...createBackendLifecycle(),
    loadStore(scope) {
      loads.push(scope)
      return savedStores.get(encodeRuntimeCacheBackendScopeKey(scope)) ?? []
    },
    mutateStore(scope, mutation) {
      applyBackendMutation(savedStores, scope, mutation)
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
    ...createBackendLifecycle(),
    loadStore(scope) {
      loadedScopes.push(scope)
      return []
    },
    mutateStore: () => undefined
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
    ...createBackendLifecycle(),
    loadStore: (scope) => {
      loadedScopes.add(encodeRuntimeCacheBackendScopeKey(scope))
      return savedStores.get(encodeRuntimeCacheBackendScopeKey(scope)) ?? []
    },
    mutateStore: (scope, mutation) => applyBackendMutation(savedStores, scope, mutation)
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

test("Cache does not synchronously persist read recency across backend reloads", async () => {
  const savedStores = new Map<string, RuntimeCacheEntry[]>()
  const backend: RuntimeCacheBackend = {
    ...createBackendLifecycle(),
    loadStore(scope) {
      return savedStores.get(encodeRuntimeCacheBackendScopeKey(scope)) ?? []
    },
    mutateStore(scope, mutation) {
      applyBackendMutation(savedStores, scope, mutation)
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
        assert.equal(cache.has("a"), false)
        assert.equal(cache.get("b"), "1234")
        assert.equal(cache.get("c"), "1234")
      }
    )
  } finally {
    uninstallBackend()
  }
})

test("Cache get updates memory recency without synchronously persisting", async () => {
  let mutationCount = 0
  const backend: RuntimeCacheBackend = {
    ...createBackendLifecycle(),
    loadStore: () => [],
    mutateStore: () => {
      mutationCount++
    }
  }
  const uninstallBackend = installExtensionRuntimeCacheBackend(backend)

  try {
    await runWithCacheContext(async () => {
      const cache = new Cache({ namespace: "nonpersistent-read-recency" })
      cache.set("page", "page-1")
      const mutationCountBeforeGet = mutationCount

      assert.equal(cache.get("page"), "page-1")
      assert.equal(mutationCount, mutationCountBeforeGet)
    })
  } finally {
    uninstallBackend()
  }
})

test("Cache read and subscribe do not persist over-capacity backend snapshots", async () => {
  let mutationCount = 0
  const backend: RuntimeCacheBackend = {
    ...createBackendLifecycle(),
    loadStore: () => [
      ["a", "1234"],
      ["b", "1234"],
      ["c", "1234"]
    ],
    mutateStore: () => {
      mutationCount++
    }
  }
  const uninstallBackend = installExtensionRuntimeCacheBackend(backend)

  try {
    await runWithCacheContext(async () => {
      const cache = new Cache({ capacity: 10, namespace: "over-capacity-read" })
      assert.equal(cache.get("a"), "1234")
      const unsubscribe = cache.subscribe(() => undefined)
      assert.equal(cache.has("b"), true)
      unsubscribe()
      assert.equal(mutationCount, 0)

      cache.set("d", "1234")
      assert.equal(mutationCount, 1)
    })
  } finally {
    uninstallBackend()
  }
})

test("Cache reports asynchronous backend subscription admission failure once", async () => {
  const admissionError = new Error("bounded async admission failure")
  const failures: unknown[] = []
  let unsubscribeCount = 0
  const backend: RuntimeCacheBackend = {
    ...createBackendLifecycle(),
    loadStore: () => [],
    mutateStore: () => undefined,
    subscribeStore: () => ({
      ready: Promise.reject(admissionError),
      unsubscribe: () => {
        unsubscribeCount++
      }
    })
  }
  const uninstallBackend = installExtensionRuntimeCacheBackend(backend)

  try {
    await runWithCacheContext(
      async () => {
        const unsubscribe = new Cache({ namespace: "async-admission-failure" }).subscribe(
          () => undefined
        )
        await new Promise<void>((resolve) => setImmediate(resolve))
        assert.deepEqual(failures, [admissionError])
        assert.equal(unsubscribeCount, 1)
        unsubscribe()
        assert.equal(unsubscribeCount, 1)
      },
      createAvailableDataIdentity(),
      "search-page",
      (error) => failures.push(error)
    )
  } finally {
    uninstallBackend()
  }
})

test("Cache applies only newer backend snapshots and cancels the change feed", async () => {
  let activeListener: Parameters<RuntimeCacheBackend["subscribeStore"]>[1] | null = null
  let initialEntries: RuntimeCacheEntry[] = []
  let unsubscribeCount = 0
  const backend: RuntimeCacheBackend = {
    ...createBackendLifecycle(),
    loadStore: () => [],
    mutateStore: () => undefined,
    subscribeStore(_scope, listener) {
      activeListener = listener
      listener({ entries: initialEntries, revision: 0 })
      return {
        ready: Promise.resolve(),
        unsubscribe: () => {
          if (activeListener === listener) {
            activeListener = null
          }
          unsubscribeCount++
        }
      }
    }
  }
  const uninstallBackend = installExtensionRuntimeCacheBackend(backend)

  try {
    await runWithCacheContext(() => {
      const cache = new Cache({ namespace: "live-snapshot-ordering" })
      const events: Array<{ data: string | undefined; key: string | undefined }> = []
      const unsubscribe = cache.subscribe((key, data) => events.push({ data, key }))
      const listener = activeListener
      assert.ok(listener)

      listener({ entries: [["page", "page-2"]], revision: 2 })
      listener({ entries: [["page", "stale-page"]], revision: 1 })
      listener({ entries: [], revision: 3 })

      assert.deepEqual(events, [
        { data: "page-2", key: "page" },
        { data: undefined, key: "page" }
      ])
      assert.equal(cache.get("page"), undefined)

      unsubscribe()
      assert.equal(activeListener, null)
      assert.equal(unsubscribeCount, 1)

      initialEntries = [["page", "resubscribed-page"]]
      const resumedEvents: Array<{ data: string | undefined; key: string | undefined }> = []
      const unsubscribeResumed = cache.subscribe((key, data) => resumedEvents.push({ data, key }))
      assert.deepEqual(resumedEvents, [{ data: "resubscribed-page", key: "page" }])
      assert.equal(cache.get("page"), "resubscribed-page")
      unsubscribeResumed()
      assert.equal(unsubscribeCount, 2)
    })
  } finally {
    uninstallBackend()
  }
})

test("Cache isolates throwing subscribers and preserves reentrant notification order", async () => {
  let activeListener: Parameters<RuntimeCacheBackend["subscribeStore"]>[1] | null = null
  const backend: RuntimeCacheBackend = {
    ...createBackendLifecycle(),
    loadStore: () => [],
    mutateStore: () => undefined,
    subscribeStore(_scope, listener) {
      activeListener = listener
      listener({ entries: [], revision: 0 })
      return {
        ready: Promise.resolve(),
        unsubscribe: () => {
          if (activeListener === listener) {
            activeListener = null
          }
        }
      }
    }
  }
  const uninstallBackend = installExtensionRuntimeCacheBackend(backend)
  const failures: unknown[] = []

  try {
    await runWithCacheContext(
      () => {
        const cache = new Cache({ namespace: "subscriber-reentrant-order" })
        const observed: string[] = []
        const lateObserved: string[] = []
        const reusedObserved: string[] = []
        const selfObserved: string[] = []
        let unsubscribeLate: () => void = () => undefined
        const reusedSubscriber = (key: string | undefined, data?: string): void => {
          reusedObserved.push(`${key}:${data}`)
        }
        let unsubscribeReused: () => void = () => undefined
        let unsubscribeSelf: () => void = () => undefined

        const unsubscribeThrowing = cache.subscribe(() => {
          throw new Error("subscriber exploded")
        })
        const unsubscribeReentrant = cache.subscribe((key, data) => {
          observed.push(`${key}:${data}`)
          if (key === "a") {
            const oldUnsubscribeReused = unsubscribeReused
            oldUnsubscribeReused()
            unsubscribeReused = cache.subscribe(reusedSubscriber)
            oldUnsubscribeReused()
            unsubscribeLate = cache.subscribe((lateKey, lateData) => {
              lateObserved.push(`${lateKey}:${lateData}`)
            })
            cache.set("b", "local-b")
          }
        })
        unsubscribeReused = cache.subscribe(reusedSubscriber)
        unsubscribeSelf = cache.subscribe((key, data) => {
          selfObserved.push(`${key}:${data}`)
          unsubscribeSelf()
        })
        const listener = activeListener
        assert.ok(listener)

        listener({
          entries: [
            ["a", "external-a"],
            ["b", "external-b"]
          ],
          revision: 1
        })

        assert.deepEqual(observed, ["a:external-a", "b:local-b"])
        assert.deepEqual(lateObserved, ["b:local-b"])
        assert.deepEqual(reusedObserved, ["b:local-b"])
        assert.deepEqual(selfObserved, ["a:external-a"])
        assert.equal(cache.get("b"), "local-b")
        assert.equal(failures.length, 2)

        unsubscribeLate()
        unsubscribeReused()
        unsubscribeReentrant()
        unsubscribeThrowing()
      },
      createAvailableDataIdentity(),
      "search-page",
      (error) => failures.push(error)
    )
  } finally {
    uninstallBackend()
  }
})

test("Cache migrates an active change feed when the backend is replaced", async () => {
  const first = createTrackedSnapshotBackend([["page", "first"]])
  const second = createTrackedSnapshotBackend([["page", "second"]])
  const uninstallFirst = installExtensionRuntimeCacheBackend(first.backend)

  try {
    await runWithCacheContext(() => {
      const cache = new Cache({ namespace: "backend-replacement-feed" })
      const events: string[] = []
      const unsubscribe = cache.subscribe((_key, data) => events.push(data ?? "removed"))
      assert.equal(first.subscribeCount, 1)
      assert.equal(first.unsubscribeCount, 0)

      const uninstallSecond = installExtensionRuntimeCacheBackend(second.backend)
      assert.equal(first.unsubscribeCount, 1)
      assert.equal(second.subscribeCount, 1)
      first.publishLate([["page", "late-first"]], 99)
      assert.equal(cache.get("page"), "second")
      assert.deepEqual(events, ["first", "second"])

      unsubscribe()
      assert.equal(second.unsubscribeCount, 1)
      uninstallSecond()
    })
  } finally {
    uninstallFirst()
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

function createBackendLifecycle(): Pick<
  RuntimeCacheBackend,
  "close" | "flush" | "onFailure" | "subscribeStore"
> {
  return {
    close: async () => undefined,
    flush: async () => undefined,
    onFailure: () => () => undefined,
    subscribeStore: () => ({ ready: Promise.resolve(), unsubscribe: () => undefined })
  }
}

function applyBackendMutation(
  stores: Map<string, RuntimeCacheEntry[]>,
  scope: RuntimeCacheBackendScope,
  mutation: RuntimeCacheBackendMutation
): void {
  const scopeKey = encodeRuntimeCacheBackendScopeKey(scope)
  if (mutation.kind === "clear") {
    stores.set(scopeKey, [])
    return
  }

  const entries = new Map(stores.get(scopeKey) ?? [])
  for (const key of mutation.removeKeys) {
    entries.delete(key)
  }
  for (const [key, data] of mutation.upsertEntries) {
    entries.delete(key)
    entries.set(key, data)
  }
  stores.set(scopeKey, Array.from(entries))
}

async function runWithCacheContext<T>(
  callback: () => Promise<T> | T,
  dataIdentity: ExtensionRuntimeDataIdentityState = createAvailableDataIdentity(),
  commandName = "search-page",
  reportFatalError?: (error: unknown) => void
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
      ...(reportFatalError ? { reportFatalError } : {}),
      requestHost
    },
    callback
  )
}

function createTrackedSnapshotBackend(initialEntries: RuntimeCacheEntry[]): {
  backend: RuntimeCacheBackend
  publishLate: (entries: RuntimeCacheEntry[], revision: number) => void
  readonly subscribeCount: number
  readonly unsubscribeCount: number
} {
  let subscribeCount = 0
  let unsubscribeCount = 0
  let lastListener: Parameters<RuntimeCacheBackend["subscribeStore"]>[1] | null = null
  const backend: RuntimeCacheBackend = {
    ...createBackendLifecycle(),
    loadStore: () => initialEntries,
    mutateStore: () => undefined,
    subscribeStore(_scope, listener) {
      subscribeCount++
      lastListener = listener
      listener({ entries: initialEntries, revision: 0 })
      return {
        ready: Promise.resolve(),
        unsubscribe: () => {
          unsubscribeCount++
        }
      }
    }
  }
  return {
    backend,
    publishLate(entries, revision) {
      lastListener?.({ entries, revision })
    },
    get subscribeCount() {
      return subscribeCount
    },
    get unsubscribeCount() {
      return unsubscribeCount
    }
  }
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
