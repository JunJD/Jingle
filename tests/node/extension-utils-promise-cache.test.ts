import assert from "node:assert/strict"
import test from "node:test"
import { createElement, useState } from "react"
import { Cache, Detail } from "@jingle/extension-api"
import {
  createExtensionRuntimeNavigation,
  ExtensionRuntimeNavigationProvider,
  installExtensionRuntimeCacheBackend,
  runWithExtensionRuntimeSdk,
  type ExtensionRuntimeHostContextValue,
  type ExtensionRuntimeSdkContextValue,
  type RuntimeCacheBackend,
  type RuntimeCacheBackendMutation,
  type RuntimeCacheBackendScope,
  type RuntimeCacheEntry
} from "@jingle/extension-api/host-runtime"
import {
  useCachedPromise,
  useFetch,
  type CachedPromiseMutate
} from "../../packages/extension-utils/src"
import {
  createPromiseArgumentsIdentity,
  createPromiseCacheBinding,
  createPromiseCacheIdentity,
  type PromiseCacheFailure,
  type PromiseCacheValue
} from "../../packages/extension-utils/src/promise-cache"
import { createExtensionRuntimeRenderer } from "../../src/extension-runtime/reconciler/render"

const AVAILABLE_DATA_IDENTITY = {
  cache: {
    commandConfigGeneration: 5,
    connectionConfigGeneration: 4,
    extensionConfigGeneration: 3,
    kind: "available" as const,
    runtimeArtifactRevision: "sha256:extension-utils-test",
    runtimePackageRevision: "1.2.3"
  },
  kind: "available" as const,
  localStorage: {
    connectionId: "workspace",
    credentialGeneration: 2
  }
}

function FunctionalUrlDependenciesTypeContract() {
  // @ts-expect-error Functional URLs must explicitly declare their resource dependencies.
  useFetch(() => "https://api.notion.test/search", { execute: false })
  return null
}

void FunctionalUrlDependenciesTypeContract

test("promise cache identity is canonical and isolates every supported argument fact", () => {
  assert.equal(
    createPromiseArgumentsIdentity([{ a: 1, b: 2 }]),
    createPromiseArgumentsIdentity([{ b: 2, a: 1 }])
  )

  const identities = [
    createPromiseArgumentsIdentity([undefined]),
    createPromiseArgumentsIdentity([null]),
    createPromiseArgumentsIdentity([Number.NaN]),
    createPromiseArgumentsIdentity([Infinity]),
    createPromiseArgumentsIdentity([-Infinity]),
    createPromiseArgumentsIdentity([-0]),
    createPromiseArgumentsIdentity([0]),
    createPromiseArgumentsIdentity([new Date("2026-07-17T00:00:00.000Z")]),
    createPromiseArgumentsIdentity([new URL("https://example.com/page")]),
    createPromiseArgumentsIdentity([Array(1)]),
    createPromiseArgumentsIdentity([[undefined]])
  ]
  assert.equal(new Set(identities).size, identities.length)
  assert.notEqual(
    createPromiseCacheIdentity(function first() {
      return 1
    }, []).namespace,
    createPromiseCacheIdentity(function second() {
      return 2
    }, []).namespace
  )
})

test("promise cache identity rejects ambiguous and stateful argument shapes", () => {
  const circular: unknown[] = []
  circular.push(circular)
  class OpaqueValue {}
  const accessor = Object.defineProperty({}, "value", {
    enumerable: true,
    get: () => 1
  })
  const customArray = [1]
  ;(customArray as number[] & { label?: string }).label = "state"

  for (const value of [
    circular,
    Symbol("value"),
    new Map(),
    new Set(),
    new Uint8Array([1]),
    Promise.resolve(),
    (() => undefined).bind(null),
    new OpaqueValue(),
    accessor,
    customArray
  ]) {
    assert.throws(() => createPromiseArgumentsIdentity([value]), /Promise identity/)
  }
})

test("promise cache binding consumes the complete SDK scope without render-path persistence", async () => {
  const memoryBackend = createMemoryBackend()
  const uninstallBackend = installExtensionRuntimeCacheBackend(memoryBackend.backend)
  const context = createSdkContext("scope-owner")

  try {
    await runWithExtensionRuntimeSdk(context, async () => {
      const identity = createPromiseCacheIdentity(loadScopedValue, ["page-1"])
      const binding = createPromiseCacheBinding(identity)

      assert.deepEqual(binding.getSnapshot(), { kind: "miss" })
      assert.equal(memoryBackend.mutationCount, 0)
      assert.deepEqual(memoryBackend.loadedScopes, [])

      const unsubscribe = binding.subscribe(() => undefined)
      await flushPromises()
      assert.deepEqual(memoryBackend.loadedScopes, [
        {
          commandName: "scope-owner",
          extensionName: "notion",
          identity: {
            commandConfigGeneration: 5,
            connectionConfigGeneration: 4,
            connectionId: "workspace",
            credentialGeneration: 2,
            extensionConfigGeneration: 3,
            kind: "available",
            runtimeArtifactRevision: "sha256:extension-utils-test",
            runtimePackageRevision: "1.2.3"
          },
          namespace: identity.namespace
        }
      ])
      unsubscribe()
    })
  } finally {
    uninstallBackend()
  }
})

test("useCachedPromise reads the durable snapshot only after render commits", async () => {
  const loadValue = async () => "network"
  const identity = createPromiseCacheIdentity(loadValue, [])
  let rendering = false
  let loadCount = 0
  const memoryBackend = createMemoryBackend({
    onLoad() {
      assert.equal(rendering, false)
      loadCount += 1
    }
  })
  const context = createHostContext("render-safe-read")
  let uninstallBackend = installExtensionRuntimeCacheBackend(memoryBackend.backend)

  try {
    await runWithExtensionRuntimeSdk(toSdkContext(context), () => {
      assert.equal(createPromiseCacheBinding<string>(identity).write(cacheValue("stale")), true)
    })
    uninstallBackend()
    uninstallBackend = installExtensionRuntimeCacheBackend(memoryBackend.backend)
    loadCount = 0
    const mutationCountBeforeRender = memoryBackend.mutationCount

    const renderer = createExtensionRuntimeRenderer({
      commandName: "render-safe-read",
      extensionName: "notion"
    })
    function Surface() {
      rendering = true
      try {
        const state = useCachedPromise(loadValue, [], { execute: false })
        return createElement(Detail, {
          markdown: `${state.data ?? "missing"}:${state.isLoading ? "loading" : "ready"}`,
          navigationTitle: "Render-safe cache read"
        })
      } finally {
        rendering = false
      }
    }

    renderer.render(withRuntimeProvider(context, createElement(Surface)))
    await flushPromises()
    await renderer.flushSnapshots()

    assert.equal(loadCount, 1)
    assert.equal(memoryBackend.mutationCount, mutationCountBeforeRender)
    assert.equal(getDetailMarkdown(renderer), "stale:ready")
  } finally {
    uninstallBackend()
  }
})

test("promise cache binding closes the construction-to-subscribe race with an exact re-read", async () => {
  const memoryBackend = createMemoryBackend()
  const uninstallBackend = installExtensionRuntimeCacheBackend(memoryBackend.backend)
  const context = createSdkContext("atomic-subscribe")

  try {
    await runWithExtensionRuntimeSdk(context, () => {
      const identity = createPromiseCacheIdentity(loadScopedValue, ["page-2"])
      const observer = createPromiseCacheBinding<string>(identity)
      const writer = createPromiseCacheBinding<string>(identity)
      assert.deepEqual(observer.getSnapshot(), { kind: "miss" })

      assert.equal(writer.write(cacheValue("written-before-subscribe")), true)
      let notificationCount = 0
      const unsubscribe = observer.subscribe(() => {
        notificationCount += 1
      })

      assert.deepEqual(observer.getSnapshot(), {
        kind: "value",
        value: cacheValue("written-before-subscribe")
      })
      assert.equal(notificationCount, 1)
      unsubscribe()
    })
  } finally {
    uninstallBackend()
  }
})

test("promise cache binding skips exact repeat writes without mutation or notification", async () => {
  const memoryBackend = createMemoryBackend()
  const uninstallBackend = installExtensionRuntimeCacheBackend(memoryBackend.backend)
  const context = createSdkContext("same-value-no-op")

  try {
    await runWithExtensionRuntimeSdk(context, async () => {
      const identity = createPromiseCacheIdentity(loadScopedValue, ["page-same"])
      const binding = createPromiseCacheBinding<{ label: string }>(identity)
      let notificationCount = 0
      const unsubscribe = binding.subscribe(() => {
        notificationCount += 1
      })
      await flushPromises()

      assert.equal(binding.write(cacheValue({ label: "stable" })), true)
      assert.equal(memoryBackend.mutationCount, 1)
      assert.equal(notificationCount, 1)
      const committedSnapshot = binding.getSnapshot()

      for (let index = 0; index < 10_000; index += 1) {
        assert.equal(binding.write(cacheValue({ label: "stable" })), true)
      }

      assert.equal(memoryBackend.mutationCount, 1)
      assert.equal(notificationCount, 1)
      assert.equal(binding.getSnapshot(), committedSnapshot)

      new Cache({ namespace: identity.namespace }).clear({ notifySubscribers: false })
      assert.equal(memoryBackend.mutationCount, 2)
      assert.equal(notificationCount, 1)

      assert.equal(binding.write(cacheValue({ label: "stable" })), true)
      assert.equal(memoryBackend.mutationCount, 3)
      assert.equal(notificationCount, 1)

      assert.equal(binding.write(cacheValue({ label: "changed" })), true)
      assert.equal(memoryBackend.mutationCount, 4)
      assert.equal(notificationCount, 2)
      assert.deepEqual(binding.getSnapshot(), {
        kind: "value",
        value: cacheValue({ label: "changed" })
      })
      unsubscribe()
    })
  } finally {
    uninstallBackend()
  }
})

test("promise cache binding never trusts stale process-local data after resubscribe", async () => {
  const secondSubscriptionReady = createDeferred<void>()
  let subscriptionCount = 0
  const memoryBackend = createMemoryBackend({
    async beforeSubscriptionSnapshot(scope) {
      if (scope.commandName !== "resubscribe-stale-value") {
        return
      }
      subscriptionCount += 1
      if (subscriptionCount === 2) {
        await secondSubscriptionReady.promise
      }
    }
  })
  const uninstallBackend = installExtensionRuntimeCacheBackend(memoryBackend.backend)
  const context = createSdkContext("resubscribe-stale-value")

  try {
    await runWithExtensionRuntimeSdk(context, async () => {
      const identity = createPromiseCacheIdentity(loadScopedValue, ["page-resubscribe"])
      const binding = createPromiseCacheBinding<string>(identity)
      const unsubscribeFirst = binding.subscribe(() => undefined)
      await flushPromises()

      assert.equal(binding.write(cacheValue("local-old")), true)
      unsubscribeFirst()
      const targetScope = memoryBackend.loadedScopes.find(
        (scope) =>
          scope.commandName === "resubscribe-stale-value" && scope.namespace === identity.namespace
      )
      assert.ok(targetScope, JSON.stringify(memoryBackend.loadedScopes))
      memoryBackend.backend.mutateStore(targetScope, {
        kind: "update",
        removeKeys: [],
        upsertEntries: [
          [
            identity.key,
            '{"pagination":{"kind":"none"},"value":{"data":"durable-new","kind":"json"},"version":1}'
          ]
        ]
      })
      assert.equal(memoryBackend.mutationCount, 2)

      const unsubscribeSecond = binding.subscribe(() => undefined)
      assert.deepEqual(binding.getSnapshot(), {
        kind: "value",
        value: cacheValue("local-old")
      })

      assert.equal(binding.write(cacheValue("local-old")), true)
      assert.equal(memoryBackend.mutationCount, 3)

      secondSubscriptionReady.resolve()
      await flushPromises()
      assert.deepEqual(binding.getSnapshot(), {
        kind: "value",
        value: cacheValue("local-old")
      })
      unsubscribeSecond()
    })
  } finally {
    uninstallBackend()
  }
})

test("promise cache binding waits for the first feed snapshot after a synchronous load", async () => {
  const initialSnapshotReady = createDeferred<void>()
  const memoryBackend = createMemoryBackend({
    beforeSubscriptionSnapshot: (scope) =>
      scope.commandName === "sync-load-feed" ? initialSnapshotReady.promise : Promise.resolve()
  })
  const uninstallBackend = installExtensionRuntimeCacheBackend(memoryBackend.backend)
  const context = createSdkContext("sync-load-feed")

  try {
    await runWithExtensionRuntimeSdk(context, async () => {
      const identity = createPromiseCacheIdentity(loadScopedValue, ["page-sync-load"])
      const binding = createPromiseCacheBinding<string>(identity)

      assert.equal(binding.write(cacheValue("local")), true)
      assert.equal(memoryBackend.mutationCount, 1)

      const unsubscribe = binding.subscribe(() => undefined)
      assert.equal(binding.write(cacheValue("local")), true)
      assert.equal(memoryBackend.mutationCount, 2)

      const targetScope = memoryBackend.loadedScopes.find(
        (scope) => scope.commandName === "sync-load-feed" && scope.namespace === identity.namespace
      )
      assert.ok(targetScope)
      memoryBackend.backend.mutateStore(targetScope, {
        kind: "update",
        removeKeys: [],
        upsertEntries: [
          [
            identity.key,
            '{"pagination":{"kind":"none"},"value":{"data":"external","kind":"json"},"version":1}'
          ]
        ]
      })
      assert.equal(memoryBackend.mutationCount, 3)

      assert.equal(binding.write(cacheValue("local")), true)
      assert.equal(memoryBackend.mutationCount, 4)

      initialSnapshotReady.resolve()
      await flushPromises()
      assert.deepEqual(binding.getSnapshot(), {
        kind: "value",
        value: cacheValue("local")
      })
      unsubscribe()
    })
  } finally {
    uninstallBackend()
  }
})

test("promise cache binding invalidates same-value ownership while replacing the backend", async () => {
  const replacementSnapshotReady = createDeferred<void>()
  const firstBackend = createMemoryBackend()
  const replacementBackend = createMemoryBackend({
    beforeSubscriptionSnapshot: (scope) =>
      scope.commandName === "replacement-stale-value"
        ? replacementSnapshotReady.promise
        : Promise.resolve()
  })
  const uninstallFirstBackend = installExtensionRuntimeCacheBackend(firstBackend.backend)
  const context = createSdkContext("replacement-stale-value")
  let uninstallReplacementBackend: () => void = () => undefined

  try {
    await runWithExtensionRuntimeSdk(context, async () => {
      const identity = createPromiseCacheIdentity(loadScopedValue, ["page-replacement"])
      const binding = createPromiseCacheBinding<string>(identity)
      const unsubscribe = binding.subscribe(() => undefined)
      await flushPromises()

      assert.equal(binding.write(cacheValue("local-old")), true)
      assert.equal(firstBackend.mutationCount, 1)
      const targetScope = firstBackend.loadedScopes.find(
        (scope) =>
          scope.commandName === "replacement-stale-value" && scope.namespace === identity.namespace
      )
      assert.ok(targetScope)

      replacementBackend.backend.mutateStore(targetScope, {
        kind: "update",
        removeKeys: [],
        upsertEntries: [
          [
            identity.key,
            '{"pagination":{"kind":"none"},"value":{"data":"durable-new","kind":"json"},"version":1}'
          ]
        ]
      })
      uninstallReplacementBackend = installExtensionRuntimeCacheBackend(replacementBackend.backend)
      assert.equal(replacementBackend.mutationCount, 1)

      assert.equal(binding.write(cacheValue("local-old")), true)
      assert.equal(replacementBackend.mutationCount, 2)

      replacementSnapshotReady.resolve()
      await flushPromises()
      assert.deepEqual(binding.getSnapshot(), {
        kind: "value",
        value: cacheValue("local-old")
      })
      unsubscribe()
    })
  } finally {
    uninstallReplacementBackend()
    uninstallFirstBackend()
  }
})

test("promise cache binding adopts a reentrant write before granting same-value ownership", async () => {
  const memoryBackend = createMemoryBackend()
  const uninstallBackend = installExtensionRuntimeCacheBackend(memoryBackend.backend)
  const context = createSdkContext("reentrant-write")

  try {
    await runWithExtensionRuntimeSdk(context, async () => {
      const identity = createPromiseCacheIdentity(loadScopedValue, ["page-reentrant"])
      const binding = createPromiseCacheBinding<string>(identity)
      let reentered = false
      const unsubscribe = binding.subscribe(() => {
        const snapshot = binding.getSnapshot()
        if (!reentered && snapshot.kind === "value" && snapshot.value.data === "outer-new") {
          reentered = true
          assert.equal(binding.write(cacheValue("reentrant-old")), true)
        }
      })
      await flushPromises()

      assert.equal(binding.write(cacheValue("outer-new")), false)
      assert.equal(memoryBackend.mutationCount, 2)
      assert.deepEqual(binding.getSnapshot(), {
        kind: "value",
        value: cacheValue("reentrant-old")
      })

      assert.equal(binding.write(cacheValue("outer-new")), true)
      assert.equal(memoryBackend.mutationCount, 3)
      assert.deepEqual(binding.getSnapshot(), {
        kind: "value",
        value: cacheValue("outer-new")
      })
      unsubscribe()
    })
  } finally {
    uninstallBackend()
  }
})

test("promise cache reports typed encoding and corrupt-entry recovery failures", async () => {
  const memoryBackend = createMemoryBackend()
  const uninstallBackend = installExtensionRuntimeCacheBackend(memoryBackend.backend)
  const context = createSdkContext("failure-boundary")

  try {
    await runWithExtensionRuntimeSdk(context, () => {
      const failures: PromiseCacheFailure[] = []
      const identity = createPromiseCacheIdentity(loadScopedValue, ["page-3"])
      const binding = createPromiseCacheBinding<{ updatedAt: Date }>(identity, {
        onFailure: (failure) => failures.push(failure)
      })

      assert.equal(
        binding.write(cacheValue({ updatedAt: new Date("2026-07-17T00:00:00.000Z") })),
        false
      )
      assert.deepEqual(
        failures.map(({ code, message }) => ({ code, message })),
        [
          {
            code: "promise_cache_encode_failed",
            message: "The latest data could not be encoded for the extension cache."
          }
        ]
      )
    })
  } finally {
    uninstallBackend()
  }

  const corruptIdentity = createPromiseCacheIdentity(loadScopedValue, ["page-4"])
  const corruptBackend = createMemoryBackend({
    loadEntries: [[corruptIdentity.key, "not-json"]]
  })
  const uninstallCorruptBackend = installExtensionRuntimeCacheBackend(corruptBackend.backend)
  try {
    await runWithExtensionRuntimeSdk(createSdkContext("corrupt-read"), async () => {
      const failures: PromiseCacheFailure[] = []
      const binding = createPromiseCacheBinding(corruptIdentity, {
        onFailure: (failure) => failures.push(failure)
      })
      assert.deepEqual(binding.getSnapshot(), { kind: "miss" })
      assert.equal(corruptBackend.mutationCount, 0)

      const unsubscribe = binding.subscribe(() => undefined)
      await flushPromises()
      assert.deepEqual(binding.getSnapshot(), { kind: "miss" })
      assert.equal(corruptBackend.mutationCount, 1)
      assert.deepEqual(
        failures.map(({ code, message }) => ({ code, message })),
        [
          {
            code: "promise_cache_decode_failed",
            message: "An invalid extension cache entry was discarded."
          }
        ]
      )
      unsubscribe()
    })
  } finally {
    uninstallCorruptBackend()
  }

  const unavailableContext = {
    ...createSdkContext("unavailable-identity"),
    dataIdentity: {
      cache: {
        kind: "unavailable" as const,
        reason: "artifact-revision-unavailable" as const
      },
      kind: "available" as const,
      localStorage: {
        connectionId: "workspace",
        credentialGeneration: 2
      }
    }
  }
  await runWithExtensionRuntimeSdk(unavailableContext, () => {
    const binding = createPromiseCacheBinding(
      createPromiseCacheIdentity(loadScopedValue, ["unavailable"])
    )
    assert.deepEqual(binding.getSnapshot(), { kind: "miss" })
    assert.throws(() => binding.subscribe(() => undefined), /artifact-revision-unavailable/)
  })
})

test("useCachedPromise renders stale data immediately and commits background revalidation", async () => {
  const memoryBackend = createMemoryBackend()
  let uninstallBackend = installExtensionRuntimeCacheBackend(memoryBackend.backend)
  const context = createHostContext("swr")
  const latest = createDeferred<string>()
  const loadValue = () => latest.promise
  const identity = createPromiseCacheIdentity(loadValue, [])

  try {
    await runWithExtensionRuntimeSdk(toSdkContext(context), () => {
      assert.equal(createPromiseCacheBinding<string>(identity).write(cacheValue("stale")), true)
    })
    uninstallBackend()
    uninstallBackend = installExtensionRuntimeCacheBackend(memoryBackend.backend)

    const renderer = createExtensionRuntimeRenderer({
      commandName: "swr",
      extensionName: "notion"
    })
    function Surface() {
      const state = useCachedPromise(loadValue)
      return createElement(Detail, {
        markdown: `${state.data ?? "missing"}:${state.isLoading ? "loading" : "ready"}`,
        navigationTitle: "SWR"
      })
    }
    renderer.render(withRuntimeProvider(context, createElement(Surface)))
    await flushPromises()
    await renderer.flushSnapshots()
    assert.equal(getDetailMarkdown(renderer), "stale:loading")

    latest.resolve("fresh")
    await flushPromises()
    await renderer.flushSnapshots()
    assert.equal(getDetailMarkdown(renderer), "fresh:ready")

    await runWithExtensionRuntimeSdk(toSdkContext(context), () => {
      assert.equal(createPromiseCacheBinding<string>(identity).write(cacheValue("external")), true)
    })
    await renderer.flushSnapshots()
    assert.equal(getDetailMarkdown(renderer), "external:ready")
  } finally {
    uninstallBackend()
  }
})

test("useFetch dependencies isolate functional URL resources and execute identity changes", async () => {
  const memoryBackend = createMemoryBackend()
  const uninstallBackend = installExtensionRuntimeCacheBackend(memoryBackend.backend)
  const context = createHostContext("fetch-dependencies")
  const originalFetch = globalThis.fetch
  const requestedUrls: string[] = []
  let updateQuery: ((query: string) => void) | undefined
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const requestUrl = String(input)
    requestedUrls.push(requestUrl)
    const query = new URL(requestUrl).searchParams.get("q") ?? "missing"
    return new Response(JSON.stringify({ query }), {
      headers: { "content-type": "application/json" },
      status: 200
    })
  }) as typeof fetch

  try {
    const renderer = createExtensionRuntimeRenderer({
      commandName: "fetch-dependencies",
      extensionName: "notion"
    })
    function Surface() {
      const [query, setQuery] = useState("alpha")
      updateQuery = setQuery
      const state = useFetch<{ query: string }, string>(
        ({ cursor }) =>
          `https://api.notion.test/search?q=${query}${cursor ? `&cursor=${cursor}` : ""}`,
        {
          dependencies: [query],
          mapResult: (result) => ({ data: result.query })
        }
      )
      return createElement(Detail, {
        markdown: state.data ?? "missing",
        navigationTitle: "Fetch Dependencies"
      })
    }

    renderer.render(withRuntimeProvider(context, createElement(Surface)))
    await flushPromises()
    await renderer.flushSnapshots()
    assert.equal(getDetailMarkdown(renderer), "alpha")
    assert.ok(updateQuery)

    updateQuery("beta")
    await flushPromises()
    await renderer.flushSnapshots()

    assert.equal(getDetailMarkdown(renderer), "beta")
    assert.deepEqual(requestedUrls, [
      "https://api.notion.test/search?q=alpha",
      "https://api.notion.test/search?q=beta"
    ])
    assert.equal(new Set(memoryBackend.upsertedKeys).size, 2)
  } finally {
    globalThis.fetch = originalFetch
    uninstallBackend()
  }
})

test("a stale mutate callback adopts the live cache snapshot and rolls back exactly", async () => {
  const memoryBackend = createMemoryBackend()
  const uninstallBackend = installExtensionRuntimeCacheBackend(memoryBackend.backend)
  const context = createHostContext("mutation")
  const loadValue = async () => "network"
  const identity = createPromiseCacheIdentity(loadValue, [])
  const staleMutate = { current: null as CachedPromiseMutate<string> | null }

  try {
    await runWithExtensionRuntimeSdk(toSdkContext(context), () => {
      assert.equal(createPromiseCacheBinding<string>(identity).write(cacheValue("initial")), true)
    })

    const renderer = createExtensionRuntimeRenderer({
      commandName: "mutation",
      extensionName: "notion"
    })
    function Surface() {
      const state = useCachedPromise(loadValue, [], { execute: false })
      staleMutate.current ??= state.mutate
      return createElement(Detail, {
        markdown: state.data ?? "missing",
        navigationTitle: "Mutation"
      })
    }
    renderer.render(withRuntimeProvider(context, createElement(Surface)))
    await renderer.flushSnapshots()
    assert.equal(getDetailMarkdown(renderer), "initial")
    assert.ok(staleMutate.current)

    await runWithExtensionRuntimeSdk(toSdkContext(context), () => {
      assert.equal(createPromiseCacheBinding<string>(identity).write(cacheValue("external")), true)
    })
    await renderer.flushSnapshots()
    assert.equal(getDetailMarkdown(renderer), "external")

    const mutation = createDeferred<void>()
    const mutationPromise = staleMutate.current(mutation.promise, {
      optimisticUpdate: (current) => `${current}-optimistic`,
      shouldRevalidateAfter: false
    })
    await renderer.flushSnapshots()
    assert.equal(getDetailMarkdown(renderer), "external-optimistic")

    mutation.reject(new Error("mutation failed"))
    await assert.rejects(mutationPromise, /mutation failed/)
    await renderer.flushSnapshots()
    assert.equal(getDetailMarkdown(renderer), "external")
  } finally {
    uninstallBackend()
  }
})

test("useCachedPromise projects a bounded cache encoding warning without hiding fresh data", async () => {
  const memoryBackend = createMemoryBackend()
  const uninstallBackend = installExtensionRuntimeCacheBackend(memoryBackend.backend)
  const hostRequests: Parameters<ExtensionRuntimeSdkContextValue["requestHost"]>[0][] = []
  const context = createHostContext("visible-failure", hostRequests)

  try {
    const renderer = createExtensionRuntimeRenderer({
      commandName: "visible-failure",
      extensionName: "notion"
    })
    function Surface() {
      const state = useCachedPromise(async () => ({ updatedAt: new Date() }))
      return createElement(Detail, {
        markdown: state.data ? "fresh" : "missing",
        navigationTitle: "Failure"
      })
    }
    renderer.render(withRuntimeProvider(context, createElement(Surface)))
    await flushPromises()
    await renderer.flushSnapshots()

    assert.equal(getDetailMarkdown(renderer), "fresh")
    const toastRequest = hostRequests.find((request) => request.capability === "toast")
    assert.equal(toastRequest?.capability, "toast")
    if (toastRequest?.capability === "toast") {
      assert.equal(
        toastRequest.payload.message,
        "The latest data could not be encoded for the extension cache."
      )
      assert.equal(toastRequest.payload.style, "failure")
      assert.equal(toastRequest.payload.title, "Latest data could not be cached")
    }
  } finally {
    uninstallBackend()
  }
})

function loadScopedValue(_id: string): string {
  return "unused"
}

function cacheValue<TResult>(data: TResult): PromiseCacheValue<TResult> {
  return { data, pagination: { kind: "none" } }
}

function createSdkContext(commandName: string): ExtensionRuntimeSdkContextValue {
  const requestHost: ExtensionRuntimeSdkContextValue["requestHost"] = async () => ({
    id: "extension-utils-test",
    ok: true,
    result: null
  })
  return {
    ...createHostContext(commandName),
    navigation: createExtensionRuntimeNavigation({ requestHost }),
    requestHost
  }
}

function createHostContext(
  commandName: string,
  hostRequests: Parameters<ExtensionRuntimeSdkContextValue["requestHost"]>[0][] = []
): Omit<ExtensionRuntimeHostContextValue, "navigation"> {
  return {
    commandName,
    commandPreferences: {},
    dataIdentity: AVAILABLE_DATA_IDENTITY,
    extensionName: "notion",
    extensionPreferences: {},
    initialAction: "open",
    locale: "en-US",
    mode: "view",
    reportFatalError: () => undefined,
    requestHost: async (request) => {
      hostRequests.push(request)
      return { id: "extension-utils-test", ok: true, result: null }
    },
    seedQuery: ""
  }
}

function toSdkContext(
  context: Omit<ExtensionRuntimeHostContextValue, "navigation">
): ExtensionRuntimeSdkContextValue {
  return {
    ...context,
    navigation: createExtensionRuntimeNavigation({ requestHost: context.requestHost })
  }
}

function withRuntimeProvider(
  context: Omit<ExtensionRuntimeHostContextValue, "navigation">,
  element: ReturnType<typeof createElement>
) {
  return createElement(ExtensionRuntimeNavigationProvider, { value: context }, element)
}

function createMemoryBackend(
  options: {
    beforeSubscriptionSnapshot?: (scope: RuntimeCacheBackendScope) => Promise<void>
    loadEntries?: RuntimeCacheEntry[]
    onLoad?: () => void
  } = {}
): {
  backend: RuntimeCacheBackend
  loadedScopes: RuntimeCacheBackendScope[]
  readonly mutationCount: number
  upsertedKeys: string[]
} {
  const stores = new Map<string, RuntimeCacheEntry[]>()
  const loadedScopes: RuntimeCacheBackendScope[] = []
  const upsertedKeys: string[] = []
  let mutationCount = 0
  const backend: RuntimeCacheBackend = {
    close: async () => undefined,
    flush: async () => undefined,
    loadStore(scope) {
      options.onLoad?.()
      loadedScopes.push(scope)
      return options.loadEntries ?? stores.get(JSON.stringify(scope)) ?? []
    },
    mutateStore(scope, mutation) {
      mutationCount += 1
      if (mutation.kind === "update") {
        upsertedKeys.push(...mutation.upsertEntries.map(([key]) => key))
      }
      stores.set(
        JSON.stringify(scope),
        applyMutation(stores.get(JSON.stringify(scope)) ?? [], mutation)
      )
    },
    onFailure: () => () => undefined,
    subscribeStore(scope, listener) {
      let active = true
      const ready = Promise.resolve().then(async () => {
        await options.beforeSubscriptionSnapshot?.(scope)
        if (active) {
          listener({ entries: backend.loadStore(scope), revision: 0 })
        }
      })
      return {
        ready,
        unsubscribe: () => {
          active = false
        }
      }
    }
  }
  return {
    backend,
    loadedScopes,
    upsertedKeys,
    get mutationCount() {
      return mutationCount
    }
  }
}

function applyMutation(
  current: RuntimeCacheEntry[],
  mutation: RuntimeCacheBackendMutation
): RuntimeCacheEntry[] {
  if (mutation.kind === "clear") {
    return []
  }
  const entries = new Map(current)
  for (const key of mutation.removeKeys) entries.delete(key)
  for (const [key, value] of mutation.upsertEntries) entries.set(key, value)
  return [...entries]
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function getDetailMarkdown(renderer: ReturnType<typeof createExtensionRuntimeRenderer>): string {
  const snapshot = renderer.getSnapshot()
  assert.equal(snapshot?.kind, "detail")
  if (snapshot?.kind !== "detail") {
    throw new Error("Expected a detail snapshot")
  }
  return snapshot.markdown ?? ""
}
