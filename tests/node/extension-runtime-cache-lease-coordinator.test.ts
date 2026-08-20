import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import test from "node:test"
import * as properLockfile from "proper-lockfile"
import {
  ExtensionRuntimeCacheLeaseCoordinatorError,
  FileExtensionRuntimeCacheLeaseCoordinator
} from "../../src/main/services/extension-runtime/cache-lease-coordinator"
import { createFileExtensionRuntimeCacheBackend } from "../../src/extension-runtime/cache-backend"
import type { RuntimeCacheBackendScope } from "@jingle/extension-api/host-runtime"
import type { ExtensionRuntimeCacheExecutionPrincipal } from "../../src/shared/extension-runtime-protocol"

const scope: RuntimeCacheBackendScope = {
  commandName: "search-page",
  extensionName: "notion",
  identity: {
    commandConfigGeneration: 1,
    connectionConfigGeneration: 2,
    connectionId: "workspace",
    credentialGeneration: 3,
    extensionConfigGeneration: 4,
    kind: "available",
    runtimeArtifactRevision: `sha256:${"a".repeat(64)}`,
    runtimePackageRevision: "1.2.3"
  },
  namespace: "writer-lease"
}
const principal: ExtensionRuntimeCacheExecutionPrincipal = {
  commandName: scope.commandName,
  extensionName: scope.extensionName,
  identity: scope.identity
}

test("cache lease coordinator atomically replaces one session writer", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const coordinator = new FileExtensionRuntimeCacheLeaseCoordinator(cacheDir)
    const firstLease = await coordinator.activate("session-1", principal)
    const firstBackend = createFileExtensionRuntimeCacheBackend(cacheDir, {
      writerLease: firstLease
    })
    firstBackend.mutateStore(scope, {
      kind: "update",
      removeKeys: [],
      upsertEntries: [["page", "first"]]
    })
    await firstBackend.flush()
    removeStoreFiles(cacheDir)

    const replacementLease = await coordinator.activate("session-1", principal)
    assert.notEqual(replacementLease.token, firstLease.token)
    firstBackend.mutateStore(scope, {
      kind: "update",
      removeKeys: [],
      upsertEntries: [["page", "stale"]]
    })
    await assert.rejects(firstBackend.flush(), assertBoundedPersistenceFailure)
    assert.deepEqual(listStoreFiles(cacheDir), [])

    const replacementBackend = createFileExtensionRuntimeCacheBackend(cacheDir, {
      writerLease: replacementLease
    })
    replacementBackend.mutateStore(scope, {
      kind: "update",
      removeKeys: [],
      upsertEntries: [["page", "replacement"]]
    })
    await replacementBackend.flush()
    assert.deepEqual(replacementBackend.loadStore(scope), [["page", "replacement"]])

    await coordinator.revokeWrites(firstLease)
    assert.deepEqual(replacementBackend.loadStore(scope), [["page", "replacement"]])
    await coordinator.dispose()
  })
})

test("cache lease coordinator removes pre-principal retention records before strict reads", async () => {
  await withCacheDirectory(async (cacheDir) => {
    mkdirSync(cacheDir, { recursive: true })
    const legacySessionId = "legacy-session"
    const legacyToken = "0".repeat(64)
    const legacyDigest = createHash("sha256")
      .update(JSON.stringify([legacySessionId, legacyToken]))
      .digest("hex")
    writeFileSync(
      join(cacheDir, `retention-lease-${legacyDigest}.json`),
      `${JSON.stringify({
        addresses: [{ namespaceDigest: "1".repeat(64), storeKeyDigest: "2".repeat(64) }],
        sessionId: legacySessionId,
        token: legacyToken,
        version: 2
      })}\n`
    )

    const coordinator = new FileExtensionRuntimeCacheLeaseCoordinator(cacheDir)
    assert.deepEqual(listRetentionRecords(cacheDir), [])

    const lease = await coordinator.activate("session-1", principal)
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease: lease })
    const subscription = backend.subscribeStore(scope, () => undefined)
    assert.equal((await subscription.admission).kind, "admitted")
    assert.equal(listRetentionRecords(cacheDir).length, 1)
    subscription.unsubscribe()
    await backend.close()
    await coordinator.dispose()
  })
})

test("cache writer control record binds the main-owned execution principal", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const coordinator = new FileExtensionRuntimeCacheLeaseCoordinator(cacheDir)
    const lease = await coordinator.activate("session-1", principal)
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease: lease })
    const writerLeasePath = join(cacheDir, listWriterLeases(cacheDir)[0]!)
    const stored = JSON.parse(readFileSync(writerLeasePath, "utf8")) as {
      principal: ExtensionRuntimeCacheExecutionPrincipal
    }
    writeFileSync(
      writerLeasePath,
      `${JSON.stringify({
        ...stored,
        principal: { ...stored.principal, commandName: "notifications" }
      })}\n`
    )

    backend.mutateStore(scope, {
      kind: "update",
      removeKeys: [],
      upsertEntries: [["page", "must-not-persist"]]
    })
    await assert.rejects(backend.flush(), assertBoundedPersistenceFailure)
    assert.deepEqual(listStoreFiles(cacheDir), [])

    await coordinator.dispose()
  })
})

test("revoked cache writer cannot persist corruption recovery", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const coordinator = new FileExtensionRuntimeCacheLeaseCoordinator(cacheDir)
    const lease = await coordinator.activate("session-1", principal)
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease: lease })
    backend.mutateStore(scope, {
      kind: "update",
      removeKeys: [],
      upsertEntries: [["page", "before"]]
    })
    await backend.flush()
    const cacheFilePath = join(cacheDir, listStoreFiles(cacheDir)[0]!)
    const corruptPayload = '{"stores":'
    writeFileSync(cacheFilePath, corruptPayload)
    await coordinator.revokeWrites(lease)

    assert.throws(() => backend.loadStore(scope), assertBoundedPersistenceFailure)
    assert.equal(readFileSync(cacheFilePath, "utf8"), corruptPayload)
    assert.equal(
      readdirSync(cacheDir).some((name) => name.endsWith(".corrupt")),
      false
    )
    await coordinator.dispose()
  })
})

test("revoked cache writer cannot recreate a removed cache directory", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const coordinator = new FileExtensionRuntimeCacheLeaseCoordinator(cacheDir)
    const lease = await coordinator.activate("session-1", principal)
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease: lease })
    await coordinator.revokeWrites(lease)
    rmSync(cacheDir, { recursive: true })

    backend.mutateStore(scope, {
      kind: "update",
      removeKeys: [],
      upsertEntries: [["page", "stale"]]
    })
    await assert.rejects(backend.flush(), assertBoundedPersistenceFailure)
    assert.equal(existsSync(cacheDir), false)

    await coordinator.dispose()
  })
})

test("process-exit cleanup waits for short writer and retention lock contention", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const coordinator = new FileExtensionRuntimeCacheLeaseCoordinator(cacheDir, {
      lock: { retryCount: 20, retryTimeoutMs: 5, staleMs: 30_000, updateMs: 10_000 }
    })
    const lease = await coordinator.activate("session-1", principal)
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease: lease })
    const subscription = backend.subscribeStore(scope, () => undefined)
    await subscription.admission
    subscription.unsubscribe()
    assert.equal(listWriterLeases(cacheDir).length, 1)
    assert.equal(listRetentionRecords(cacheDir).length, 1)

    const releaseLock = await properLockfile.lock(cacheDir, {
      realpath: false,
      retries: 0,
      stale: 30_000,
      update: 10_000
    })
    const revokeWrites = coordinator.revokeWrites(lease)
    const releaseRetention = coordinator.releaseRetention(lease)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(listWriterLeases(cacheDir).length, 1)
    assert.equal(listRetentionRecords(cacheDir).length, 1)

    await releaseLock()
    await Promise.all([revokeWrites, releaseRetention])
    assert.deepEqual(listRetentionRecords(cacheDir), [])
    assert.deepEqual(listWriterLeases(cacheDir), [])
    await coordinator.dispose()
  })
})

test("cache control lock timeout returns one bounded coordination failure", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const coordinator = new FileExtensionRuntimeCacheLeaseCoordinator(cacheDir, {
      lock: { retryCount: 0, retryTimeoutMs: 1, staleMs: 30_000, updateMs: 10_000 }
    })
    const releaseLock = await properLockfile.lock(cacheDir, {
      realpath: false,
      retries: 0,
      stale: 30_000,
      update: 10_000
    })

    await assert.rejects(coordinator.activate("session-1", principal), (error) => {
      assert.ok(error instanceof ExtensionRuntimeCacheLeaseCoordinatorError)
      assert.equal(error.code, "runtime_cache_writer_lease_failed")
      assert.equal(error.message, "Extension runtime cache writer lease coordination failed.")
      return true
    })
    assert.deepEqual(listWriterLeases(cacheDir), [])

    await releaseLock()
    await coordinator.dispose()
  })
})

test("cache coordinator serializes dispose with in-flight process cleanup", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const coordinator = new FileExtensionRuntimeCacheLeaseCoordinator(cacheDir)
    const firstLease = await coordinator.activate("session-1", principal)
    await coordinator.activate("session-2", principal)
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease: firstLease })
    const subscription = backend.subscribeStore(scope, () => undefined)
    await subscription.admission
    subscription.unsubscribe()

    const releaseLock = await properLockfile.lock(cacheDir, {
      realpath: false,
      retries: 0,
      stale: 30_000,
      update: 10_000
    })
    const releaseFirst = coordinator.releaseRetention(firstLease)
    const dispose = coordinator.dispose()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(listWriterLeases(cacheDir).length, 2)

    await releaseLock()
    await Promise.all([releaseFirst, dispose])
    assert.deepEqual(listRetentionRecords(cacheDir), [])
    assert.deepEqual(listWriterLeases(cacheDir), [])
    await coordinator.dispose()
  })
})

test("cache coordinator disposes later leases and retries only failed terminal cleanup", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const coordinator = new FileExtensionRuntimeCacheLeaseCoordinator(cacheDir)
    const firstLease = await coordinator.activate("session-1", principal)
    await coordinator.activate("session-2", principal)
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease: firstLease })
    const subscription = backend.subscribeStore(scope, () => undefined)
    await subscription.admission
    subscription.unsubscribe()
    const retentionPath = getRetentionRecordPath(cacheDir, firstLease)
    writeFileSync(retentionPath, "not-json")

    await assert.rejects(coordinator.dispose(), (error) => {
      assert.ok(error instanceof ExtensionRuntimeCacheLeaseCoordinatorError)
      assert.ok(error.cause instanceof AggregateError)
      assert.equal(error.cause.errors.length, 1)
      return true
    })
    assert.deepEqual(listWriterLeases(cacheDir), [])
    assert.deepEqual(listRetentionRecords(cacheDir), [basename(retentionPath)])

    rmSync(retentionPath)
    await coordinator.dispose()
    assert.deepEqual(listRetentionRecords(cacheDir), [])
    assert.deepEqual(listWriterLeases(cacheDir), [])
    await backend.close()
  })
})

test("same-session replacement retains failed old cleanup for dispose retry", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const coordinator = new FileExtensionRuntimeCacheLeaseCoordinator(cacheDir)
    const firstLease = await coordinator.activate("session-1", principal)
    const firstBackend = createFileExtensionRuntimeCacheBackend(cacheDir, {
      writerLease: firstLease
    })
    const firstSubscription = firstBackend.subscribeStore(scope, () => undefined)
    await firstSubscription.admission
    firstSubscription.unsubscribe()
    await coordinator.revokeWrites(firstLease)

    const replacementLease = await coordinator.activate("session-1", principal)
    const replacementBackend = createFileExtensionRuntimeCacheBackend(cacheDir, {
      writerLease: replacementLease
    })
    const replacementSubscription = replacementBackend.subscribeStore(scope, () => undefined)
    await replacementSubscription.admission
    replacementSubscription.unsubscribe()

    const firstRetentionPath = getRetentionRecordPath(cacheDir, firstLease)
    writeFileSync(firstRetentionPath, "not-json")
    await assert.rejects(coordinator.releaseRetention(firstLease), /coordination failed/)
    replacementBackend.mutateStore(scope, {
      kind: "update",
      removeKeys: [],
      upsertEntries: [["page", "replacement"]]
    })
    await assert.rejects(replacementBackend.flush(), assertBoundedPersistenceFailure)

    await assert.rejects(coordinator.dispose(), (error) => {
      assert.ok(error instanceof ExtensionRuntimeCacheLeaseCoordinatorError)
      assert.ok(error.cause instanceof AggregateError)
      assert.equal(error.cause.errors.length, 1)
      return true
    })
    assert.deepEqual(listWriterLeases(cacheDir), [])
    assert.deepEqual(listRetentionRecords(cacheDir), [basename(firstRetentionPath)])

    rmSync(firstRetentionPath)
    await coordinator.dispose()
    assert.deepEqual(listRetentionRecords(cacheDir), [])
    assert.deepEqual(listWriterLeases(cacheDir), [])
    await firstBackend.close()
    await assert.rejects(replacementBackend.close(), assertBoundedPersistenceFailure)
  })
})

test("cache lease coordinator rejects invalid session identity with one bounded error", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const coordinator = new FileExtensionRuntimeCacheLeaseCoordinator(cacheDir)

    await assert.rejects(coordinator.activate("x".repeat(129), principal), (error) => {
      assert.ok(error instanceof ExtensionRuntimeCacheLeaseCoordinatorError)
      assert.equal(error.code, "runtime_cache_writer_lease_failed")
      assert.equal(error.message, "Extension runtime cache writer lease coordination failed.")
      return true
    })
    await coordinator.dispose()
  })
})

function assertBoundedPersistenceFailure(error: unknown): boolean {
  assert.ok(error instanceof Error)
  assert.equal(error.name, "ExtensionRuntimeCachePersistenceError")
  assert.equal(error.message, "Extension runtime cache persistence failed.")
  return true
}

function listStoreFiles(cacheDir: string): string[] {
  return readdirSync(cacheDir).filter((name) => /^store-[a-f0-9]{64}\.json$/.test(name))
}

function listRetentionRecords(cacheDir: string): string[] {
  return readdirSync(cacheDir).filter((name) => /^retention-lease-[a-f0-9]{64}\.json$/.test(name))
}

function listWriterLeases(cacheDir: string): string[] {
  return readdirSync(cacheDir).filter((name) => /^writer-lease-[a-f0-9]{64}\.json$/.test(name))
}

function getRetentionRecordPath(
  cacheDir: string,
  lease: { sessionId: string; token: string }
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([lease.sessionId, lease.token]))
    .digest("hex")
  return join(cacheDir, `retention-lease-${digest}.json`)
}

function removeStoreFiles(cacheDir: string): void {
  for (const name of listStoreFiles(cacheDir)) {
    rmSync(join(cacheDir, name))
  }
}

async function withCacheDirectory(operation: (cacheDir: string) => Promise<void>): Promise<void> {
  const cacheDir = mkdtempSync(join(tmpdir(), "jingle-runtime-cache-lease-"))
  try {
    await operation(cacheDir)
  } finally {
    rmSync(cacheDir, { force: true, recursive: true })
    rmSync(`${cacheDir}.lock`, { force: true, recursive: true })
  }
}
