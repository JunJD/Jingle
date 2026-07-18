import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  ExtensionRuntimeCacheLeaseCoordinatorError,
  FileExtensionRuntimeCacheLeaseCoordinator
} from "../../src/main/services/extension-runtime/cache-lease-coordinator"
import { createFileExtensionRuntimeCacheBackend } from "../../src/extension-runtime/cache-backend"
import type { RuntimeCacheBackendScope } from "@jingle/extension-api/host-runtime"

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
    runtimeArtifactRevision: "sha256:artifact",
    runtimePackageRevision: "1.2.3"
  },
  namespace: "writer-lease"
}

test("cache lease coordinator atomically replaces one session writer", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const coordinator = new FileExtensionRuntimeCacheLeaseCoordinator(cacheDir)
    const firstLease = coordinator.activate("session-1")
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

    const replacementLease = coordinator.activate("session-1")
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

    coordinator.revoke(firstLease)
    assert.deepEqual(replacementBackend.loadStore(scope), [["page", "replacement"]])
    coordinator.dispose()
  })
})

test("revoked cache writer cannot persist corruption recovery", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const coordinator = new FileExtensionRuntimeCacheLeaseCoordinator(cacheDir)
    const lease = coordinator.activate("session-1")
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
    coordinator.revoke(lease)

    assert.throws(() => backend.loadStore(scope), assertBoundedPersistenceFailure)
    assert.equal(readFileSync(cacheFilePath, "utf8"), corruptPayload)
    assert.equal(
      readdirSync(cacheDir).some((name) => name.endsWith(".corrupt")),
      false
    )
    coordinator.dispose()
  })
})

test("revoked cache writer cannot recreate a removed cache directory", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const coordinator = new FileExtensionRuntimeCacheLeaseCoordinator(cacheDir)
    const lease = coordinator.activate("session-1")
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease: lease })
    coordinator.revoke(lease)
    rmSync(cacheDir, { recursive: true })

    backend.mutateStore(scope, {
      kind: "update",
      removeKeys: [],
      upsertEntries: [["page", "stale"]]
    })
    await assert.rejects(backend.flush(), assertBoundedPersistenceFailure)
    assert.equal(existsSync(cacheDir), false)

    coordinator.dispose()
  })
})

test("cache lease coordinator rejects invalid session identity with one bounded error", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const coordinator = new FileExtensionRuntimeCacheLeaseCoordinator(cacheDir)

    assert.throws(
      () => coordinator.activate("x".repeat(129)),
      (error) => {
        assert.ok(error instanceof ExtensionRuntimeCacheLeaseCoordinatorError)
        assert.equal(error.code, "runtime_cache_writer_lease_failed")
        assert.equal(error.message, "Extension runtime cache writer lease coordination failed.")
        return true
      }
    )
    coordinator.dispose()
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
