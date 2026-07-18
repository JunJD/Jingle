import assert from "node:assert/strict"
import test from "node:test"
import type {
  RuntimeCacheBackend,
  RuntimeCacheBackendFailureListener
} from "@jingle/extension-api/host-runtime"
import { createExtensionRuntimeCacheLifecycle } from "../../src/extension-runtime/cache-lifecycle"

class FakeRuntimeCacheBackend implements RuntimeCacheBackend {
  private readonly failureListeners = new Set<RuntimeCacheBackendFailureListener>()
  flushImplementation: () => Promise<void> = async () => undefined

  flush(): Promise<void> {
    return this.flushImplementation()
  }

  close(): Promise<void> {
    return this.flushImplementation()
  }

  loadStore(): [] {
    return []
  }

  mutateStore(): void {
    return undefined
  }

  onFailure(listener: RuntimeCacheBackendFailureListener): () => void {
    this.failureListeners.add(listener)
    return () => {
      this.failureListeners.delete(listener)
    }
  }

  subscribeStore(): () => void {
    return () => undefined
  }

  reportFailure(): void {
    for (const listener of this.failureListeners) {
      listener(new Error("raw cache path must stay inside the utility process"))
    }
  }
}

test("runtime cache lifecycle flushes before ready and graceful stop", async () => {
  const backend = new FakeRuntimeCacheBackend()
  let flushCount = 0
  backend.flushImplementation = async () => {
    flushCount++
  }
  const failures: string[] = []
  const lifecycle = createExtensionRuntimeCacheLifecycle(backend, {
    onPersistenceFailure: (sessionId) => failures.push(sessionId),
    writerSessionId: "session-1"
  })

  lifecycle.bindSession("session-1")

  assert.equal(await lifecycle.flushBeforeReady("session-1"), true)
  assert.deepEqual(await lifecycle.stop("session-1"), { kind: "flushed" })
  assert.equal(flushCount, 2)
  assert.deepEqual(failures, [])
})

test("runtime cache lifecycle reports one typed failure across ready and stop", async () => {
  const backend = new FakeRuntimeCacheBackend()
  const failures: string[] = []
  const lifecycle = createExtensionRuntimeCacheLifecycle(backend, {
    onPersistenceFailure: (sessionId) => failures.push(sessionId),
    writerSessionId: "session-1"
  })

  backend.reportFailure()
  lifecycle.bindSession("session-1")

  assert.equal(await lifecycle.flushBeforeReady("session-1"), false)
  assert.deepEqual(await lifecycle.stop("session-1"), {
    kind: "cache-persistence-failed"
  })
  assert.deepEqual(failures, ["session-1"])
})

test("runtime cache lifecycle converts an unreported flush rejection into a typed failure", async () => {
  const backend = new FakeRuntimeCacheBackend()
  backend.flushImplementation = async () => {
    throw new Error("private cache directory")
  }
  const failures: string[] = []
  const lifecycle = createExtensionRuntimeCacheLifecycle(backend, {
    onPersistenceFailure: (sessionId) => failures.push(sessionId),
    writerSessionId: "session-1"
  })
  lifecycle.bindSession("session-1")

  assert.equal(await lifecycle.flushBeforeReady("session-1"), false)
  assert.deepEqual(failures, ["session-1"])
})

test("runtime cache lifecycle preserves the typed stop result when immediate failure projection throws", async () => {
  const backend = new FakeRuntimeCacheBackend()
  backend.flushImplementation = async () => {
    throw new Error("private cache directory")
  }
  const lifecycle = createExtensionRuntimeCacheLifecycle(backend, {
    onPersistenceFailure: () => {
      throw new Error("parent port unavailable")
    },
    writerSessionId: "session-1"
  })
  lifecycle.bindSession("session-1")

  assert.deepEqual(await lifecycle.stop("session-1"), {
    kind: "cache-persistence-failed"
  })
})

test("runtime cache lifecycle rejects cross-session reuse", () => {
  const lifecycle = createExtensionRuntimeCacheLifecycle(null, {
    onPersistenceFailure: () => undefined,
    writerSessionId: null
  })
  lifecycle.bindSession("session-1")

  assert.throws(() => lifecycle.bindSession("session-2"), /already bound/)
})

test("runtime cache lifecycle rejects a start message for another writer session", () => {
  const lifecycle = createExtensionRuntimeCacheLifecycle(new FakeRuntimeCacheBackend(), {
    onPersistenceFailure: () => undefined,
    writerSessionId: "session-1"
  })

  assert.throws(() => lifecycle.bindSession("session-2"), /does not belong/)
})
