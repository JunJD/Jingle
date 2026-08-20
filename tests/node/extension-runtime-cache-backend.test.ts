import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import test from "node:test"
import { promisify } from "node:util"
import {
  activateExtensionRuntimeCacheWriterLease,
  createFileExtensionRuntimeCacheBackend as createOwnedFileExtensionRuntimeCacheBackend,
  EXTENSION_RUNTIME_CACHE_MAX_ACTIVE_FILE_BYTES,
  EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES,
  EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_BYTES,
  EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES,
  EXTENSION_RUNTIME_CACHE_MAX_FILE_SET_BYTES,
  EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE,
  ExtensionRuntimeCacheWriterPrincipalError,
  releaseExtensionRuntimeCacheRetention,
  resolveExtensionRuntimeCacheWriterEnvironment,
  revokeExtensionRuntimeCacheWrites,
  type RuntimeCacheDirectoryWatch,
  type RuntimeCacheFileBackendOptions,
  writeRuntimeCacheBufferFully,
  writeRuntimeCacheBufferFullySync
} from "../../src/extension-runtime/cache-backend"
import { createExtensionRuntimeCacheLifecycle } from "../../src/extension-runtime/cache-lifecycle"
import {
  encodeRuntimeCacheBackendScopeKey,
  type RuntimeCacheBackend,
  type RuntimeCacheBackendScope,
  type RuntimeCacheEntry
} from "@jingle/extension-api/host-runtime"
import type { ExtensionRuntimeCacheWriterLease } from "../../src/shared/extension-runtime-protocol"

const cacheIdentity = {
  commandConfigGeneration: 1,
  connectionConfigGeneration: 2,
  connectionId: "workspace",
  credentialGeneration: 3,
  extensionConfigGeneration: 4,
  kind: "available" as const,
  runtimeArtifactRevision: `sha256:${"a".repeat(64)}`,
  runtimePackageRevision: "1.2.3"
}

const notionScope = createScope("search-page")
const notionSecondaryScope = createScope("notifications")
const execFileAsync = promisify(execFile)
const cacheCorruptionRecoveryDiagnostic =
  "[jingle:extension-runtime] Extension runtime cache corruption was recovered."
const CACHE_RETENTION_TEMP_PATTERN =
  /^retention-lease-[a-f0-9]{64}\.json\.[0-9]+\.[0-9a-f-]{36}\.tmp$/
const CACHE_WRITER_TEMP_PATTERN = /^writer-lease-[a-f0-9]{64}\.json\.[0-9]+\.[0-9a-f-]{36}\.tmp$/
let testWriterLeaseIndex = 0

type TestRuntimeCacheFileBackendOptions = Omit<RuntimeCacheFileBackendOptions, "writerLease"> & {
  writerLease?: ExtensionRuntimeCacheWriterLease
}

function createFileExtensionRuntimeCacheBackend(
  cacheDir: string,
  options: TestRuntimeCacheFileBackendOptions = {}
): RuntimeCacheBackend {
  if (options.writerLease) {
    return createOwnedFileExtensionRuntimeCacheBackend(cacheDir, {
      ...options,
      writerLease: options.writerLease
    })
  }

  const backends = new Map<string, RuntimeCacheBackend>()
  const failureListeners = new Map<
    Parameters<RuntimeCacheBackend["onFailure"]>[0],
    Map<RuntimeCacheBackend, () => void>
  >()
  const backendFor = (scope: RuntimeCacheBackendScope): RuntimeCacheBackend => {
    const principalKey = JSON.stringify([scope.extensionName, scope.commandName, scope.identity])
    const existing = backends.get(principalKey)
    if (existing) {
      return existing
    }
    const writerLease = createWriterLease(
      scope,
      `backend-test-${testWriterLeaseIndex}`,
      (++testWriterLeaseIndex).toString(16).padStart(64, "0")
    )
    try {
      mkdirSync(cacheDir, { recursive: true })
      const digest = createHash("sha256").update(writerLease.sessionId).digest("hex")
      writeFileSync(
        join(cacheDir, `writer-lease-${digest}.json`),
        `${JSON.stringify({ ...writerLease, version: 2 })}\n`,
        { mode: 0o600 }
      )
    } catch {
      // Preserve the backend's own bounded persistence failure for invalid test directories.
    }
    const backend = createOwnedFileExtensionRuntimeCacheBackend(cacheDir, {
      ...options,
      writerLease
    })
    backends.set(principalKey, backend)
    for (const [listener, disposers] of failureListeners) {
      disposers.set(backend, backend.onFailure(listener))
    }
    return backend
  }

  return {
    async close() {
      await Promise.all(Array.from(backends.values(), (backend) => backend.close()))
    },
    async flush() {
      let flushedBackendCount: number
      do {
        const currentBackends = Array.from(backends.values())
        flushedBackendCount = currentBackends.length
        await Promise.all(currentBackends.map((backend) => backend.flush()))
      } while (backends.size !== flushedBackendCount)
    },
    loadStore(scope) {
      return backendFor(scope).loadStore(scope)
    },
    mutateStore(scope, mutation) {
      backendFor(scope).mutateStore(scope, mutation)
    },
    onFailure(listener) {
      const disposers = new Map<RuntimeCacheBackend, () => void>()
      failureListeners.set(listener, disposers)
      for (const backend of backends.values()) {
        disposers.set(backend, backend.onFailure(listener))
      }
      return () => {
        failureListeners.delete(listener)
        for (const dispose of disposers.values()) {
          dispose()
        }
      }
    },
    subscribeStore(scope, listener) {
      return backendFor(scope).subscribeStore(scope, listener)
    }
  }
}

test("cache evidence write helpers drain short writes and reject no progress", async () => {
  const input = Buffer.from("bounded-evidence")
  const asyncChunks: Buffer[] = []
  await writeRuntimeCacheBufferFully(
    {
      async write(buffer, offset, length) {
        const bytesWritten = Math.min(length, 2)
        asyncChunks.push(Buffer.from(buffer.subarray(offset, offset + bytesWritten)))
        return { bytesWritten }
      }
    },
    input,
    input.length
  )
  assert.equal(Buffer.concat(asyncChunks).toString(), input.toString())

  const syncChunks: Buffer[] = []
  writeRuntimeCacheBufferFullySync(
    (buffer, offset, length) => {
      const bytesWritten = Math.min(length, 3)
      syncChunks.push(Buffer.from(buffer.subarray(offset, offset + bytesWritten)))
      return bytesWritten
    },
    input,
    input.length
  )
  assert.equal(Buffer.concat(syncChunks).toString(), input.toString())

  await assert.rejects(
    writeRuntimeCacheBufferFully({ write: async () => ({ bytesWritten: 0 }) }, input, input.length),
    /did not make valid progress/
  )
  assert.throws(
    () => writeRuntimeCacheBufferFullySync(() => 0, input, input.length),
    /did not make valid progress/
  )
})

test("file runtime cache backend persists entries by exact scope", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(backend, notionScope, [["page", "page-1"]])
    writeEntries(
      backend,
      {
        ...notionScope,
        extensionName: "github"
      },
      [["issue", "issue-1"]]
    )
    await backend.flush()
    if (process.platform !== "win32") {
      const cacheFile = readdirSync(cacheDir).find((name) => name.endsWith(".json"))
      assert.ok(cacheFile)
      assert.equal(statSync(join(cacheDir, cacheFile)).mode & 0o777, 0o600)
    }

    const reloadedBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    assert.deepEqual(reloadedBackend.loadStore(notionScope), [["page", "page-1"]])
    assert.deepEqual(reloadedBackend.loadStore({ ...notionScope, extensionName: "github" }), [
      ["issue", "issue-1"]
    ])
  })
})

test("file runtime cache backend serializes competing writers without losing scopes", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const firstBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const secondBackend = createFileExtensionRuntimeCacheBackend(cacheDir)

    writeEntries(firstBackend, notionScope, [["page", "page-1"]])
    writeEntries(secondBackend, notionSecondaryScope, [["notification", "notification-1"]])
    await Promise.all([firstBackend.flush(), secondBackend.flush()])

    const reloadedBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    assert.deepEqual(reloadedBackend.loadStore(notionScope), [["page", "page-1"]])
    assert.deepEqual(reloadedBackend.loadStore(notionSecondaryScope), [
      ["notification", "notification-1"]
    ])
  })
})

test("file runtime cache backend merges independent utility mutations in one exact scope", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const workerSource = `
      const {
        activateExtensionRuntimeCacheWriterLease,
        createFileExtensionRuntimeCacheBackend
      } = require(${JSON.stringify(resolve("src/extension-runtime/cache-backend.ts"))});
      const identity = ${JSON.stringify(cacheIdentity)};
      void (async () => {
        const scope = {
          commandName: "search-page",
          extensionName: "notion",
          identity,
          namespace: "shared-process-cache"
        };
        const lease = {
          principal: {
            commandName: scope.commandName,
            extensionName: scope.extensionName,
            identity: scope.identity
          },
          sessionId: "worker-" + process.pid,
          token: (process.env.WORKER === "first" ? "1" : "2").repeat(64)
        };
        await activateExtensionRuntimeCacheWriterLease(process.env.CACHE_DIR, lease);
        const backend = createFileExtensionRuntimeCacheBackend(process.env.CACHE_DIR, {
          writerLease: lease
        });
        for (let index = 0; index < 12; index++) {
          backend.mutateStore(scope, {
            kind: "update",
            removeKeys: [],
            upsertEntries: [[process.env.WORKER + "-" + index, process.env.WORKER.repeat(16_384)]]
          });
        }
        await backend.flush();
      })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    `
    const runWorker = (worker: string) =>
      execFileAsync(process.execPath, ["--require", "tsx/cjs", "--eval", workerSource], {
        cwd: process.cwd(),
        env: { ...process.env, CACHE_DIR: cacheDir, WORKER: worker },
        timeout: 90_000
      })

    let writersDone = false
    let writerError: unknown
    const writers = Promise.all([runWorker("first"), runWorker("second")])
      .catch((error: unknown) => {
        writerError = error
      })
      .finally(() => {
        writersDone = true
      })
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    while (!writersDone) {
      backend.loadStore({
        ...notionScope,
        namespace: "shared-process-cache"
      })
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    await writers
    if (writerError) {
      throw writerError
    }

    const entries = new Map(
      backend.loadStore({
        ...notionScope,
        namespace: "shared-process-cache"
      })
    )
    assert.equal(entries.size, 24)
    for (const worker of ["first", "second"]) {
      for (let index = 0; index < 12; index++) {
        assert.equal(entries.get(`${worker}-${index}`), worker.repeat(16_384))
      }
    }
  })
})

test("file runtime cache backend keeps directory and file lock order across processes", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const workerSource = `
      const {
        activateExtensionRuntimeCacheWriterLease,
        createFileExtensionRuntimeCacheBackend
      } = require(${JSON.stringify(resolve("src/extension-runtime/cache-backend.ts"))});
      const identity = ${JSON.stringify(cacheIdentity)};
      void (async () => {
        const scope = {
          commandName: "search-page",
          extensionName: "notion",
          identity,
          namespace: process.env.WORKER + "-namespace-0"
        };
        const lease = {
          principal: {
            commandName: scope.commandName,
            extensionName: scope.extensionName,
            identity: scope.identity
          },
          sessionId: "worker-" + process.pid,
          token: (process.env.WORKER === "first" ? "3" : "4").repeat(64)
        };
        await activateExtensionRuntimeCacheWriterLease(process.env.CACHE_DIR, lease);
        const backend = createFileExtensionRuntimeCacheBackend(process.env.CACHE_DIR, {
          writerLease: lease
        });
        for (let index = 0; index < 20; index++) {
          backend.mutateStore({
            commandName: "search-page",
            extensionName: "notion",
            identity,
            namespace: process.env.WORKER + "-namespace-" + index
          }, {
            kind: "update",
            removeKeys: [],
            upsertEntries: [["worker", process.env.WORKER]]
          });
        }
        await backend.flush();
      })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    `
    const runWorker = (worker: string) =>
      execFileAsync(process.execPath, ["--require", "tsx/cjs", "--eval", workerSource], {
        cwd: process.cwd(),
        env: { ...process.env, CACHE_DIR: cacheDir, WORKER: worker },
        timeout: 90_000
      })

    await Promise.all([runWorker("first"), runWorker("second")])

    assertCacheDirectoryQuota(cacheDir)
    assert.equal(
      listRegularCacheArtifacts(cacheDir).some((name) => name.endsWith(".tmp")),
      false
    )
  })
})

test("file runtime cache backend preserves queued order and input snapshots", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const mutableEntries: Array<readonly [string, string]> = [["page", "first"]]

    writeEntries(backend, notionScope, mutableEntries)
    mutableEntries[0] = ["page", "mutated-after-schedule"]
    writeEntries(backend, notionScope, [["page", "second"]])
    await backend.flush()

    assert.deepEqual(createFileExtensionRuntimeCacheBackend(cacheDir).loadStore(notionScope), [
      ["page", "second"]
    ])
  })
})

test("file runtime cache backend applies remove and clear mutations", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(backend, notionScope, [
      ["first", "first-value"],
      ["second", "second-value"]
    ])
    await backend.flush()

    backend.mutateStore(notionScope, {
      kind: "update",
      removeKeys: ["first"],
      upsertEntries: []
    })
    await backend.flush()
    assert.deepEqual(createFileExtensionRuntimeCacheBackend(cacheDir).loadStore(notionScope), [
      ["second", "second-value"]
    ])

    backend.mutateStore(notionScope, { kind: "clear" })
    await backend.flush()
    assert.deepEqual(createFileExtensionRuntimeCacheBackend(cacheDir).loadStore(notionScope), [])
    assert.equal(existsSync(getCacheFilePathForScope(cacheDir, notionScope)), false)
  })
})

test("file runtime cache backend clears one empty namespace without deleting another", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const clearedScope = { ...notionScope, namespace: "cleared-namespace" }
    const retainedScope = { ...notionScope, namespace: "retained-namespace" }
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(backend, clearedScope, [["cleared", "value"]])
    writeEntries(backend, retainedScope, [["retained", "value"]])
    await backend.flush()

    backend.mutateStore(clearedScope, { kind: "clear" })
    await backend.flush()

    assert.equal(existsSync(getCacheFilePathForScope(cacheDir, clearedScope)), false)
    assert.equal(existsSync(getCacheFilePathForScope(cacheDir, retainedScope)), true)
    assert.deepEqual(backend.loadStore(retainedScope), [["retained", "value"]])
    assertCacheDirectoryQuota(cacheDir)
  })
})

test("file runtime cache backend bounds namespaces and lets a late backend recreate one exact scope", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const lateBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const currentBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const scopes = Array.from(
      { length: EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES + 4 },
      (_, index) => ({ ...notionScope, namespace: `directory-generation-${index}` })
    )
    for (const [index, scope] of scopes.entries()) {
      writeEntries(currentBackend, scope, [["generation", String(index)]])
    }
    await currentBackend.flush()

    assertCacheDirectoryQuota(cacheDir)
    const evictedScope = scopes.find(
      (scope) => !existsSync(getCacheFilePathForScope(cacheDir, scope))
    )
    assert.ok(evictedScope)

    writeEntries(lateBackend, evictedScope, [["generation", "late-recreated"]])
    await lateBackend.flush()

    assert.deepEqual(lateBackend.loadStore(evictedScope), [["generation", "late-recreated"]])
    assertCacheDirectoryQuota(cacheDir)
  })
})

test("file runtime cache backend removes stale orphan locks across inactive namespaces", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const staleScopes = Array.from({ length: 4 }, (_, index) => ({
      ...notionScope,
      namespace: `crashed-namespace-${index}`
    }))
    const staleTimestamp = new Date(Date.now() - 60_000)
    const staleLockPaths = staleScopes.map(
      (scope) => `${getCacheFilePathForScope(cacheDir, scope)}.lock`
    )
    for (const lockPath of staleLockPaths) {
      mkdirSync(lockPath)
      utimesSync(lockPath, staleTimestamp, staleTimestamp)
    }

    const freshLockPath = `${getCacheFilePathForScope(cacheDir, {
      ...notionScope,
      namespace: "active-namespace"
    })}.lock`
    mkdirSync(freshLockPath)
    const nonEmptyLockPath = `${getCacheFilePathForScope(cacheDir, {
      ...notionScope,
      namespace: "foreign-nonempty-namespace"
    })}.lock`
    mkdirSync(nonEmptyLockPath)
    writeFileSync(join(nonEmptyLockPath, "foreign"), "preserved")
    utimesSync(nonEmptyLockPath, staleTimestamp, staleTimestamp)
    const unknownDirectory = join(cacheDir, `store-${"f".repeat(64)}.json.lock.unknown`)
    mkdirSync(unknownDirectory)
    const symlinkTarget = join(cacheDir, "outside-lock-target")
    const symlinkLockPath = `${getCacheFilePathForScope(cacheDir, {
      ...notionScope,
      namespace: "foreign-symlink-namespace"
    })}.lock`
    if (process.platform !== "win32") {
      writeFileSync(symlinkTarget, "outside")
      symlinkSync(symlinkTarget, symlinkLockPath)
    }

    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(backend, notionScope, [["page", "page-1"]])
    await backend.flush()

    for (const lockPath of staleLockPaths) {
      assert.equal(existsSync(lockPath), false)
    }
    assert.equal(existsSync(freshLockPath), true)
    assert.equal(readFileSync(join(nonEmptyLockPath, "foreign"), "utf8"), "preserved")
    assert.equal(lstatSync(unknownDirectory).isDirectory(), true)
    if (process.platform !== "win32") {
      assert.equal(lstatSync(symlinkLockPath).isSymbolicLink(), true)
      assert.equal(readFileSync(symlinkTarget, "utf8"), "outside")
    }
    assert.deepEqual(backend.loadStore(notionScope), [["page", "page-1"]])
    assertCacheDirectoryQuota(cacheDir)
  })
})

test("file runtime cache backend removes only strict stale temporary artifacts", async (context) => {
  if (process.platform === "win32") {
    context.skip("Creating symlinks is not a stable unprivileged Windows test contract.")
    return
  }

  await withCacheDirectory(async (cacheDir) => {
    const strictTemporary = join(
      cacheDir,
      `store-${"a".repeat(64)}.json.42.00000000-0000-4000-8000-000000000001.tmp`
    )
    const unknownTemporary = `${strictTemporary}.unknown`
    const directoryArtifact = join(cacheDir, `store-${"b".repeat(64)}.json`)
    const outsideFile = join(cacheDir, "outside-target")
    const symlinkArtifact = join(cacheDir, `store-${"c".repeat(64)}.json`)
    writeFileSync(strictTemporary, "stale")
    writeFileSync(unknownTemporary, "unknown")
    mkdirSync(directoryArtifact)
    writeFileSync(outsideFile, "outside")
    symlinkSync(outsideFile, symlinkArtifact)

    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(backend, notionScope, [["page", "page-1"]])
    await backend.flush()

    assert.equal(existsSync(strictTemporary), false)
    assert.equal(existsSync(unknownTemporary), true)
    assert.equal(lstatSync(directoryArtifact).isDirectory(), true)
    assert.equal(lstatSync(symlinkArtifact).isSymbolicLink(), true)
    assert.equal(readFileSync(outsideFile, "utf8"), "outside")
    assertCacheDirectoryQuota(cacheDir)
  })
})

test("file runtime cache backend rejects an exact-scope symlink without touching its target", async (context) => {
  if (process.platform === "win32") {
    context.skip("Creating symlinks is not a stable unprivileged Windows test contract.")
    return
  }

  await withCacheDirectory(async (cacheDir) => {
    const outsideFile = join(cacheDir, "outside-current-target")
    const cacheFilePath = getCacheFilePathForScope(cacheDir, notionScope)
    writeFileSync(outsideFile, "outside-current")
    symlinkSync(outsideFile, cacheFilePath)
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const failures: Error[] = []
    backend.onFailure((error) => failures.push(error))

    writeEntries(backend, notionScope, [["page", "page-1"]])
    await assert.rejects(backend.flush(), /Extension runtime cache persistence failed/)

    assert.equal(failures.length, 1)
    assert.equal(lstatSync(cacheFilePath).isSymbolicLink(), true)
    assert.equal(readFileSync(outsideFile, "utf8"), "outside-current")
  })
})

test("file runtime cache backend evicts an oversized stale legacy artifact before writing", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const oversizedLegacyPath = join(cacheDir, `store-${"d".repeat(64)}.json`)
    writeFileSync(oversizedLegacyPath, "legacy")
    truncateSync(oversizedLegacyPath, EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_BYTES + 1)

    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(backend, notionScope, [["page", "page-1"]])
    await backend.flush()

    assert.equal(existsSync(oversizedLegacyPath), false)
    assert.deepEqual(backend.loadStore(notionScope), [["page", "page-1"]])
    assertCacheDirectoryQuota(cacheDir)
  })
})

test("file runtime cache backend fails a protected oversized legacy artifact without replacing it", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const cacheFilePath = getCacheFilePathForScope(cacheDir, notionScope)
    writeFileSync(cacheFilePath, "legacy")
    truncateSync(cacheFilePath, EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_BYTES + 1)
    const originalSize = statSync(cacheFilePath).size
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const failures: Error[] = []
    backend.onFailure((error) => failures.push(error))

    writeEntries(backend, notionScope, [["page", "page-1"]])
    await assert.rejects(backend.flush(), /Extension runtime cache persistence failed/)

    assert.equal(failures.length, 1)
    assert.equal(failures[0].name, "ExtensionRuntimeCachePersistenceError")
    assert.equal(failures[0].message, "Extension runtime cache persistence failed.")
    assert.doesNotMatch(failures[0].message, /store-|jingle-runtime-cache/)
    assert.equal(statSync(cacheFilePath).size, originalSize)
    assert.equal(
      listRegularCacheArtifacts(cacheDir).some((name) => name.endsWith(".tmp")),
      false
    )
  })
})

test("file runtime cache backend bounds generation warm-up by mutation order", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const scopes = Array.from(
      { length: EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE + 4 },
      (_, index) => createGenerationScope(index)
    )
    for (const [index, scope] of scopes.entries()) {
      writeEntries(backend, scope, [["generation", String(index)]])
      await backend.flush()
    }

    const cacheFilePath = getCacheFilePath(cacheDir)
    const envelope = readCacheEnvelope(cacheFilePath)
    assert.equal(envelope.version, 1)
    assert.equal(envelope.mutationSequence, scopes.length)
    assert.equal(Object.keys(envelope.stores).length, EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE)
    assert.ok(statSync(cacheFilePath).size <= EXTENSION_RUNTIME_CACHE_MAX_ACTIVE_FILE_BYTES)

    const restartedBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    for (const [index, scope] of scopes.entries()) {
      assert.deepEqual(
        restartedBackend.loadStore(scope),
        index < scopes.length - EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE
          ? []
          : [["generation", String(index)]]
      )
    }
  })
})

test("file runtime cache backend lets an old process recreate only its exact generation", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const rollbackScope = createGenerationScope(0)
    const oldProcessBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const currentBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const scopes = Array.from(
      { length: EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE + 1 },
      (_, index) => createGenerationScope(index)
    )
    for (const [index, scope] of scopes.entries()) {
      writeEntries(currentBackend, scope, [["generation", `current-${index}`]])
      await currentBackend.flush()
    }
    assert.deepEqual(currentBackend.loadStore(rollbackScope), [])

    writeEntries(oldProcessBackend, rollbackScope, [["generation", "rollback-0"]])
    await oldProcessBackend.flush()

    const restartedBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    assert.deepEqual(restartedBackend.loadStore(rollbackScope), [["generation", "rollback-0"]])
    assert.deepEqual(restartedBackend.loadStore(scopes.at(-1)!), [
      ["generation", `current-${scopes.length - 1}`]
    ])
    assert.deepEqual(restartedBackend.loadStore(scopes[1]), [])
  })
})

test("file runtime cache backend keeps concurrent generation GC exact", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const firstBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const secondBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const scopes = Array.from(
      { length: EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE + 6 },
      (_, index) => createGenerationScope(index)
    )
    for (const [index, scope] of scopes.entries()) {
      writeEntries(index % 2 === 0 ? firstBackend : secondBackend, scope, [
        ["generation", `value-${index}`]
      ])
    }
    await Promise.all([firstBackend.flush(), secondBackend.flush()])

    const envelope = readCacheEnvelope(getCacheFilePath(cacheDir))
    assert.equal(Object.keys(envelope.stores).length, EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE)
    const restartedBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    for (const [index, scope] of scopes.entries()) {
      const storeKey = encodeRuntimeCacheBackendScopeKey(scope)
      assert.deepEqual(
        restartedBackend.loadStore(scope),
        envelope.stores[storeKey] ? [["generation", `value-${index}`]] : []
      )
    }
  })
})

test("file runtime cache backend bounds an oversized legacy envelope on mutation", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const oversizedScope = createGenerationScope(0)
    const currentScope = createGenerationScope(1)
    const seedBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(seedBackend, currentScope, [["seed", "seed"]])
    await seedBackend.flush()
    const cacheFilePath = getCacheFilePath(cacheDir)
    const oversizedValue = "x".repeat(EXTENSION_RUNTIME_CACHE_MAX_ACTIVE_FILE_BYTES)
    writeFileSync(
      cacheFilePath,
      `${JSON.stringify({
        stores: {
          [encodeRuntimeCacheBackendScopeKey(oversizedScope)]: [["oversized", oversizedValue]]
        }
      })}\n`
    )

    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(backend, currentScope, [["current", "retained"]])
    await backend.flush()

    assert.ok(statSync(cacheFilePath).size <= EXTENSION_RUNTIME_CACHE_MAX_ACTIVE_FILE_BYTES)
    assert.deepEqual(backend.loadStore(oversizedScope), [])
    assert.deepEqual(backend.loadStore(currentScope), [["current", "retained"]])
  })
})

test("file runtime cache backend retains the exact mutated legacy store before stable eviction", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const scopes = Array.from(
      { length: EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE + 1 },
      (_, index) => createGenerationScope(index)
    )
    const stores = Object.fromEntries(
      scopes.map((scope, index) => [
        encodeRuntimeCacheBackendScopeKey(scope),
        index === 0
          ? [
              ["keep", "kept-value"],
              ["remove", "removed-value"]
            ]
          : [["generation", String(index)]]
      ])
    )
    const lexicalFirstKey = Object.keys(stores).sort()[0]
    const retainedScope = scopes.find(
      (scope) => encodeRuntimeCacheBackendScopeKey(scope) === lexicalFirstKey
    )
    assert.ok(retainedScope)
    stores[lexicalFirstKey] = [
      ["keep", "kept-value"],
      ["remove", "removed-value"]
    ]

    mkdirSync(cacheDir, { recursive: true })
    const seedBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(seedBackend, retainedScope, [["seed", "seed"]])
    await seedBackend.flush()
    const cacheFilePath = getCacheFilePath(cacheDir)
    writeFileSync(cacheFilePath, `${JSON.stringify({ stores })}\n`)

    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    backend.mutateStore(retainedScope, {
      kind: "update",
      removeKeys: ["remove"],
      upsertEntries: []
    })
    await backend.flush()

    assert.deepEqual(backend.loadStore(retainedScope), [["keep", "kept-value"]])
    assert.equal(
      Object.keys(readCacheEnvelope(cacheFilePath).stores).length,
      EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE
    )
  })
})

test("file runtime cache backend resolves legacy mutation ties by UTF-8 bytes", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const currentScope = { ...notionScope, commandName: "\u{10000}-current" }
    const supplementaryScopes = Array.from(
      { length: EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE - 1 },
      (_, index) => ({ ...notionScope, commandName: `\u{10000}-${index}` })
    )
    const bmpScope = { ...notionScope, commandName: "\uE000" }
    const stores = Object.fromEntries(
      [...supplementaryScopes, bmpScope, currentScope].map((scope) => [
        encodeRuntimeCacheBackendScopeKey(scope),
        [["command", scope.commandName]]
      ])
    )

    const seedBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(seedBackend, currentScope, [["seed", "seed"]])
    await seedBackend.flush()
    const cacheFilePath = getCacheFilePath(cacheDir)
    writeFileSync(cacheFilePath, `${JSON.stringify({ stores })}\n`)

    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(backend, currentScope, [["current", "retained"]])
    await backend.flush()

    assert.deepEqual(backend.loadStore(bmpScope), [])
    assert.deepEqual(backend.loadStore(supplementaryScopes[0]), [
      ["command", supplementaryScopes[0].commandName]
    ])
    assert.deepEqual(backend.loadStore(currentScope), [
      ["command", currentScope.commandName],
      ["current", "retained"]
    ])
  })
})

test("file runtime cache backend fails an oversized current scope without replacing active data", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const preservedScope = createGenerationScope(1)
    const oversizedScope = createGenerationScope(2)
    const initialBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(initialBackend, preservedScope, [["preserved", "before-failure"]])
    await initialBackend.flush()
    const cacheFilePath = getCacheFilePath(cacheDir)
    const activeBefore = readFileSync(cacheFilePath, "utf8")

    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const failures: Error[] = []
    backend.onFailure((error) => failures.push(error))
    writeEntries(backend, oversizedScope, [
      ["oversized", "x".repeat(EXTENSION_RUNTIME_CACHE_MAX_ACTIVE_FILE_BYTES)]
    ])
    await assert.rejects(backend.flush(), /Extension runtime cache persistence failed/)

    assert.equal(failures.length, 1)
    assert.equal(readFileSync(cacheFilePath, "utf8"), activeBefore)
    const restartedBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    assert.deepEqual(restartedBackend.loadStore(preservedScope), [["preserved", "before-failure"]])
    assert.deepEqual(restartedBackend.loadStore(oversizedScope), [])
  })
})

test("file runtime cache backend closes its mutation gate before draining accepted writes", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const failures: Error[] = []
    backend.onFailure((error) => failures.push(error))
    writeEntries(backend, notionScope, [["accepted", "before-close"]])

    const closePromise = backend.close()
    assert.throws(
      () => writeEntries(backend, notionScope, [["rejected", "after-close"]]),
      /Extension runtime cache persistence failed/
    )
    await assert.rejects(closePromise, /Extension runtime cache persistence failed/)

    assert.deepEqual(createFileExtensionRuntimeCacheBackend(cacheDir).loadStore(notionScope), [
      ["accepted", "before-close"]
    ])
    assert.equal(failures.length, 1)
  })
})

test("file runtime cache backend reports terminal persistence failures with a bounded message", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "jingle-runtime-cache-failure-"))
  try {
    const cacheRootFile = join(rootDir, "file")
    writeFileSync(cacheRootFile, "not a directory")
    const backend = createFileExtensionRuntimeCacheBackend(cacheRootFile)
    const failures: Error[] = []
    backend.onFailure((error) => failures.push(error))

    writeEntries(backend, notionScope, [["page", "page-1"]])
    await assert.rejects(backend.flush(), (error) => {
      assert.ok(error instanceof Error)
      assert.equal(error.name, "ExtensionRuntimeCachePersistenceError")
      assert.equal(error.message, "Extension runtime cache persistence failed.")
      assert.doesNotMatch(error.message, /jingle-runtime-cache-failure/)
      return true
    })
    assert.equal(failures.length, 1)
    assert.throws(
      () => writeEntries(backend, notionScope, [["page", "page-2"]]),
      (error) => error === failures[0]
    )

    const lateFailures: Error[] = []
    backend.onFailure((error) => lateFailures.push(error))
    assert.equal(lateFailures.length, 1)
    assert.equal(lateFailures[0], failures[0])
  } finally {
    rmSync(rootDir, { force: true, recursive: true })
  }
})

test("file runtime cache backend quarantines a malformed envelope without terminating lifecycle", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(backend, notionScope, [["page", "page-1"]])
    await backend.flush()
    const cacheFilePath = getCacheFilePath(cacheDir)
    const corruptPayload = '{"stores":'
    writeFileSync(cacheFilePath, corruptPayload)
    const failures: Error[] = []
    backend.onFailure((error) => failures.push(error))
    const persistenceFailures: string[] = []
    const lifecycle = createExtensionRuntimeCacheLifecycle(backend, {
      onPersistenceFailure: (sessionId) => persistenceFailures.push(sessionId),
      writerSessionId: "corrupt-cache-session"
    })
    lifecycle.bindSession("corrupt-cache-session")

    const diagnostics: string[] = []
    const originalConsoleError = console.error
    console.error = (...args) => diagnostics.push(args.map(String).join(" "))
    try {
      assert.deepEqual(backend.loadStore(notionScope), [])
      assert.deepEqual(diagnostics, [cacheCorruptionRecoveryDiagnostic])
      assert.deepEqual(failures, [])
      assert.deepEqual(persistenceFailures, [])
      assert.deepEqual(await lifecycle.stop("corrupt-cache-session"), { kind: "flushed" })
    } finally {
      console.error = originalConsoleError
    }
    assert.equal(readFileSync(`${cacheFilePath}.corrupt`, "utf8"), corruptPayload)
    assert.deepEqual(JSON.parse(readFileSync(cacheFilePath, "utf8")), {
      mutationSequence: 0,
      stores: {},
      version: 1
    })

    const restartedBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const restartFailures: Error[] = []
    restartedBackend.onFailure((error) => restartFailures.push(error))
    const restartDiagnostics: string[] = []
    console.error = (...args) => restartDiagnostics.push(args.map(String).join(" "))
    try {
      assert.deepEqual(restartedBackend.loadStore(notionScope), [])
    } finally {
      console.error = originalConsoleError
    }
    assert.deepEqual(restartFailures, [])
    assert.deepEqual(restartDiagnostics, [])
  })
})

test("file runtime cache backend bounds corrupt evidence with the active envelope", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(backend, notionScope, [["page", "page-1"]])
    await backend.flush()
    const cacheFilePath = getCacheFilePath(cacheDir)
    writeFileSync(
      cacheFilePath,
      `{"stores":${"x".repeat(EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES + 1_024)}`
    )

    const diagnostics: string[] = []
    const originalConsoleError = console.error
    console.error = (...args) => diagnostics.push(args.map(String).join(" "))
    try {
      assert.deepEqual(backend.loadStore(notionScope), [])
    } finally {
      console.error = originalConsoleError
    }
    assert.deepEqual(diagnostics, [cacheCorruptionRecoveryDiagnostic])
    const activeBytes = statSync(cacheFilePath).size
    const corruptBytes = statSync(`${cacheFilePath}.corrupt`).size
    assert.ok(activeBytes <= EXTENSION_RUNTIME_CACHE_MAX_ACTIVE_FILE_BYTES)
    assert.equal(corruptBytes, EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES)
    assert.ok(activeBytes + corruptBytes <= EXTENSION_RUNTIME_CACHE_MAX_FILE_SET_BYTES)
    if (process.platform !== "win32") {
      assert.equal(statSync(`${cacheFilePath}.corrupt`).mode & 0o777, 0o600)
    }

    const restartedBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const restartDiagnostics: string[] = []
    console.error = (...args) => restartDiagnostics.push(args.map(String).join(" "))
    try {
      assert.deepEqual(restartedBackend.loadStore(notionScope), [])
    } finally {
      console.error = originalConsoleError
    }
    assert.deepEqual(restartDiagnostics, [])
    assert.equal(statSync(`${cacheFilePath}.corrupt`).size, corruptBytes)
  })
})

test("file runtime cache backend keeps current recovery artifacts inside the directory quota", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const scopes = Array.from(
      { length: EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES },
      (_, index) => ({ ...notionScope, namespace: `recovery-namespace-${index}` })
    )
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    for (const [index, scope] of scopes.entries()) {
      writeEntries(backend, scope, [["generation", String(index)]])
    }
    await backend.flush()
    const recoveredScope = scopes[0]
    const recoveredPath = getCacheFilePathForScope(cacheDir, recoveredScope)
    writeFileSync(recoveredPath, '{"stores":')

    const diagnostics: string[] = []
    const originalConsoleError = console.error
    console.error = (...args) => diagnostics.push(args.map(String).join(" "))
    try {
      assert.deepEqual(backend.loadStore(recoveredScope), [])
    } finally {
      console.error = originalConsoleError
    }

    assert.deepEqual(diagnostics, [cacheCorruptionRecoveryDiagnostic])
    assert.equal(existsSync(recoveredPath), true)
    assert.equal(existsSync(`${recoveredPath}.corrupt`), true)
    assertCacheDirectoryQuota(cacheDir)
    assert.equal(
      listRegularCacheArtifacts(cacheDir).some((name) => name.endsWith(".tmp")),
      false
    )
  })
})

test("file runtime cache backend preserves valid stores while concurrent writers quarantine corruption", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const initialBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(initialBackend, notionScope, [["page", "page-1"]])
    writeEntries(initialBackend, notionSecondaryScope, [["preserved", "notification-1"]])
    await initialBackend.flush()

    const cacheFilePath = getCacheFilePath(cacheDir)
    const cacheFile = JSON.parse(readFileSync(cacheFilePath, "utf8")) as {
      stores: Record<string, unknown>
    }
    cacheFile.stores[encodeRuntimeCacheBackendScopeKey(notionScope)] = [["corrupt-payload"]]
    writeFileSync(cacheFilePath, `${JSON.stringify(cacheFile, null, 2)}\n`)

    const failures: Error[] = []
    const firstBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const secondBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    firstBackend.onFailure((error) => failures.push(error))
    secondBackend.onFailure((error) => failures.push(error))
    const diagnostics: string[] = []
    const originalConsoleError = console.error
    console.error = (...args) => diagnostics.push(args.map(String).join(" "))
    try {
      writeEntries(firstBackend, notionScope, [["page", "page-2"]])
      writeEntries(secondBackend, notionSecondaryScope, [["new", "notification-2"]])
      await Promise.all([firstBackend.flush(), secondBackend.flush()])
    } finally {
      console.error = originalConsoleError
    }

    assert.deepEqual(failures, [])
    assert.deepEqual(diagnostics, [cacheCorruptionRecoveryDiagnostic])
    assert.match(readFileSync(`${cacheFilePath}.corrupt`, "utf8"), /corrupt-payload/)
    assert.doesNotMatch(readFileSync(cacheFilePath, "utf8"), /corrupt-payload/)

    const reloadedBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    assert.deepEqual(reloadedBackend.loadStore(notionScope), [["page", "page-2"]])
    assert.deepEqual(reloadedBackend.loadStore(notionSecondaryScope), [
      ["preserved", "notification-1"],
      ["new", "notification-2"]
    ])
  })
})

test("file runtime cache backend does not misclassify lock failures as recovered corruption", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const initialBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(initialBackend, notionScope, [["page", "page-1"]])
    await initialBackend.flush()
    const cacheFilePath = getCacheFilePath(cacheDir)
    const corruptPayload = '{"stores":'
    writeFileSync(cacheFilePath, corruptPayload)
    mkdirSync(`${cacheFilePath}.lock`)

    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const failures: Error[] = []
    backend.onFailure((error) => failures.push(error))
    const diagnostics: string[] = []
    const originalConsoleError = console.error
    console.error = (...args) => diagnostics.push(args.map(String).join(" "))
    try {
      assert.throws(
        () => backend.loadStore(notionScope),
        (error) => {
          assert.ok(error instanceof Error)
          assert.equal(error.name, "ExtensionRuntimeCachePersistenceError")
          assert.equal(error.message, "Extension runtime cache persistence failed.")
          return true
        }
      )
    } finally {
      console.error = originalConsoleError
    }

    assert.deepEqual(failures, [])
    assert.deepEqual(diagnostics, [])
    assert.equal(readFileSync(cacheFilePath, "utf8"), corruptPayload)
    assert.equal(existsSync(`${cacheFilePath}.corrupt`), false)
  })
})

test("file runtime cache backend hashes disk path segments", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(
      backend,
      {
        ...notionScope,
        extensionName: "..",
        namespace: ".."
      },
      [["page", "page-1"]]
    )
    await backend.flush()

    assert.match(readdirSync(cacheDir)[0] ?? "", /^store-[a-f0-9]{64}\.json$/)
  })
})

test("file runtime cache backend recovers an orphan lock and drains writes queued during flush", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const initialBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(initialBackend, notionScope, [["page", "page-1"]])
    await initialBackend.flush()
    const cacheFile = readdirSync(cacheDir).find((name) => /^store-[a-f0-9]{64}\.json$/.test(name))
    assert.ok(cacheFile)
    mkdirSync(join(cacheDir, `${cacheFile}.lock`))

    const recoveringBackend = createFileExtensionRuntimeCacheBackend(cacheDir, {
      lock: {
        retryCount: 40,
        retryTimeoutMs: 100,
        staleMs: 2_000,
        updateMs: 1_000
      }
    })
    const startedAt = Date.now()
    writeEntries(recoveringBackend, notionSecondaryScope, [["notification", "notification-1"]])
    const flushPromise = recoveringBackend.flush()
    writeEntries(recoveringBackend, notionScope, [["page", "page-2"]])
    await flushPromise

    assert.ok(Date.now() - startedAt >= 1_500)
    assert.deepEqual(recoveringBackend.loadStore(notionSecondaryScope), [
      ["notification", "notification-1"]
    ])
    assert.deepEqual(recoveringBackend.loadStore(notionScope), [["page", "page-2"]])
  })
})

test("live cache subscriptions reread exact durable snapshots across backend instances", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const watchHub = new FakeRuntimeCacheWatchHub()
    const firstBackend = createFileExtensionRuntimeCacheBackend(cacheDir, {
      watchDirectory: watchHub.watch
    })
    const secondBackend = createFileExtensionRuntimeCacheBackend(cacheDir, {
      watchDirectory: watchHub.watch
    })
    const snapshots: Array<{
      entries: readonly (readonly [string, string])[]
      revision: number
    }> = []
    const subscription = secondBackend.subscribeStore(notionScope, (snapshot) => {
      snapshots.push(structuredClone(snapshot))
    })
    const cacheFileName = basename(getCacheFilePathForScope(cacheDir, notionScope))

    assert.deepEqual(await subscription.admission, {
      kind: "admitted",
      snapshot: { entries: [], revision: 0 }
    })

    assert.equal(snapshots.length, 0)
    assert.equal(watchHub.activeWatcherCount, 1)

    writeEntries(firstBackend, notionScope, [["page", "external-1"]])
    await firstBackend.flush()
    watchHub.emit("store-unrelated.json")
    await settleCacheChangeFeed()
    assert.equal(snapshots.length, 0)

    watchHub.emit(cacheFileName)
    await waitForCacheCondition(() => snapshots.at(-1)?.entries[0]?.[1] === "external-1")
    assert.deepEqual(snapshots.at(-1)?.entries, [["page", "external-1"]])

    writeEntries(firstBackend, notionScope, [["page", "external-2"]])
    await firstBackend.flush()
    writeEntries(secondBackend, notionScope, [["page", "local-after-external"]])
    watchHub.emit(cacheFileName)
    await secondBackend.flush()
    await waitForCacheCondition(() => snapshots.at(-1)?.entries[0]?.[1] === "local-after-external")
    assert.deepEqual(snapshots.at(-1)?.entries, [["page", "local-after-external"]])

    watchHub.emit(cacheFileName)
    await settleCacheChangeFeed()
    assert.deepEqual(snapshots.at(-1)?.entries, [["page", "local-after-external"]])
    assert.deepEqual(
      snapshots.map((snapshot) => snapshot.revision),
      snapshots.map((_, index) => index + 1)
    )

    writeEntries(firstBackend, notionScope, [["page", "null-filename-wake"]])
    await firstBackend.flush()
    watchHub.emit(null)
    await waitForCacheCondition(() => snapshots.at(-1)?.entries[0]?.[1] === "null-filename-wake")
    assert.deepEqual(snapshots.at(-1)?.entries, [["page", "null-filename-wake"]])

    firstBackend.mutateStore(notionScope, { kind: "clear" })
    await firstBackend.flush()
    watchHub.emit(cacheFileName)
    await waitForCacheCondition(() => snapshots.at(-1)?.entries.length === 0)
    assert.deepEqual(snapshots.at(-1)?.entries, [])

    const snapshotCountBeforeCancel = snapshots.length
    subscription.unsubscribe()
    assert.equal(watchHub.activeWatcherCount, 0)
    writeEntries(firstBackend, notionScope, [["page", "after-cancel"]])
    await firstBackend.flush()
    watchHub.emit(cacheFileName)
    await settleCacheChangeFeed()
    assert.equal(snapshots.length, snapshotCountBeforeCancel)

    await firstBackend.close()
    await secondBackend.close()
  })
})

test("cache subscription admission performs no synchronous watcher or retention write", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const lease = createWriterLease(notionScope, "async-subscription", "1".repeat(64))
    await activateExtensionRuntimeCacheWriterLease(cacheDir, lease)
    const watchHub = new FakeRuntimeCacheWatchHub()
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, {
      watchDirectory: watchHub.watch,
      writerLease: lease
    })

    const cancelled = backend.subscribeStore(notionScope, () => undefined)
    cancelled.unsubscribe()
    assert.equal(watchHub.activeWatcherCount, 0)
    assert.deepEqual(listRetentionRecords(cacheDir), [])
    assert.deepEqual(await cancelled.admission, { kind: "cancelled" })
    assert.deepEqual(listRetentionRecords(cacheDir), [])

    const cancelledDuringAdmission = backend.subscribeStore(notionScope, () => undefined)
    await Promise.resolve()
    cancelledDuringAdmission.unsubscribe()
    assert.deepEqual(await cancelledDuringAdmission.admission, { kind: "cancelled" })
    assert.equal(watchHub.activeWatcherCount, 0)
    assert.equal(listRetentionRecords(cacheDir).length, 1)

    const admitted = backend.subscribeStore(notionScope, () => undefined)
    assert.equal(watchHub.activeWatcherCount, 0)
    assert.equal(listRetentionRecords(cacheDir).length, 1)

    assert.equal((await admitted.admission).kind, "admitted")

    assert.equal(watchHub.activeWatcherCount, 1)
    assert.equal(listRetentionRecords(cacheDir).length, 1)
    admitted.unsubscribe()
    assert.equal(watchHub.activeWatcherCount, 0)
    await backend.close()
  })
})

test("writer principal rejects foreign cache scopes before backend address derivation", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const lease = createWriterLease(notionScope, "principal-owner", "c".repeat(64))
    await activateExtensionRuntimeCacheWriterLease(cacheDir, lease)
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease: lease })
    const unreadableNamespace = (): never => {
      throw new Error("backend address derivation must not run")
    }
    const createForeignScope = (
      overrides: Partial<RuntimeCacheBackendScope>
    ): RuntimeCacheBackendScope =>
      Object.defineProperty(
        {
          ...notionScope,
          ...overrides
        },
        "namespace",
        { enumerable: true, get: unreadableNamespace }
      )

    assert.throws(
      () => backend.loadStore(createForeignScope({ extensionName: "github" })),
      assertWriterPrincipalMismatch
    )
    assert.throws(
      () =>
        backend.mutateStore(createForeignScope({ commandName: "notifications" }), {
          kind: "clear"
        }),
      assertWriterPrincipalMismatch
    )
    assert.throws(
      () =>
        backend.subscribeStore(
          createForeignScope({
            identity: { ...notionScope.identity, credentialGeneration: 99 }
          }),
          () => undefined
        ),
      assertWriterPrincipalMismatch
    )
    assert.equal(
      readdirSync(cacheDir).some((name) => /^store-[a-f0-9]{64}\.json$/.test(name)),
      false
    )
    assert.deepEqual(listRetentionRecords(cacheDir), [])
    await backend.close()
  })
})

test("runtime cache writer environment rejects every absent or invalid lease configuration", () => {
  const lease = createWriterLease(notionScope, "environment-owner", "d".repeat(64))
  for (const [cacheDir, rawLease] of [
    [undefined, undefined],
    ["/cache", undefined],
    [undefined, JSON.stringify(lease)],
    ["/cache", "not-json"]
  ] as const) {
    assert.throws(
      () => resolveExtensionRuntimeCacheWriterEnvironment(cacheDir, rawLease),
      /Extension runtime cache writer configuration is (?:incomplete|invalid)\./
    )
  }
  assert.deepEqual(resolveExtensionRuntimeCacheWriterEnvironment("/cache", JSON.stringify(lease)), {
    cacheDir: "/cache",
    writerLease: lease
  })
})

test("unavailable execution principal cannot claim an available cache scope", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const lease: ExtensionRuntimeCacheWriterLease = {
      principal: {
        commandName: notionScope.commandName,
        extensionName: notionScope.extensionName,
        identity: { kind: "unavailable" }
      },
      sessionId: "principal-unavailable",
      token: "d".repeat(64)
    }
    await activateExtensionRuntimeCacheWriterLease(cacheDir, lease)
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease: lease })

    assert.throws(() => backend.loadStore(notionScope), assertWriterPrincipalMismatch)
    assert.deepEqual(listRetentionRecords(cacheDir), [])
    await backend.close()
  })
})

test("cache quota rejects a retention record stored at a forged address", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const lease = createWriterLease(notionScope, "retention-address", "4".repeat(64))
    await activateExtensionRuntimeCacheWriterLease(cacheDir, lease)
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease: lease })
    const subscription = backend.subscribeStore(notionScope, () => undefined)
    await subscription.admission
    subscription.unsubscribe()
    const retentionName = listRetentionRecords(cacheDir)[0]
    assert.ok(retentionName)
    const forgedName = `retention-lease-${"f".repeat(64)}.json`
    assert.notEqual(forgedName, retentionName)
    renameSync(join(cacheDir, retentionName), join(cacheDir, forgedName))

    const forgedScope = { ...notionScope, namespace: "forged-retention-address" }
    writeEntries(backend, forgedScope, [["page", "must-not-persist"]])
    await assert.rejects(backend.flush(), /Extension runtime cache persistence failed/)
    assert.equal(existsSync(getCacheFilePathForScope(cacheDir, forgedScope)), false)
  })
})

test("cache quota bounds retention records and removes lock-protected orphan temps", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    const tempPrefix = `retention-lease-${"a".repeat(64)}.json.${process.pid}.`
    const writerTempPrefix = `writer-lease-${"b".repeat(64)}.json.${process.pid}.`
    for (let index = 0; index < 3; index++) {
      writeFileSync(
        join(
          cacheDir,
          `${tempPrefix}00000000-0000-0000-0000-${index.toString(16).padStart(12, "0")}.tmp`
        ),
        "orphan"
      )
      writeFileSync(
        join(
          cacheDir,
          `${writerTempPrefix}00000000-0000-0000-0000-${index.toString(16).padStart(12, "0")}.tmp`
        ),
        "orphan"
      )
    }
    writeEntries(backend, notionScope, [["page", "after-temp-cleanup"]])
    await backend.flush()
    assert.equal(
      readdirSync(cacheDir).some((name) => name.startsWith(tempPrefix)),
      false
    )
    assert.equal(
      readdirSync(cacheDir).some((name) => name.startsWith(writerTempPrefix)),
      false
    )
    await backend.close()
  })

  await withCacheDirectory(async (cacheDir) => {
    for (let index = 0; index < EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES * 2 + 1; index++) {
      writeFileSync(
        join(cacheDir, `retention-lease-${index.toString(16).padStart(64, "0")}.json`),
        ""
      )
    }
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(backend, notionScope, [["page", "must-not-persist"]])
    await assert.rejects(backend.flush(), /Extension runtime cache persistence failed/)
    assert.equal(existsSync(getCacheFilePathForScope(cacheDir, notionScope)), false)
  })
})

test("cache control records permit one atomic temp at the full physical budget", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const leases = Array.from(
      { length: EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES * 2 },
      (_, index) =>
        createWriterLease(notionScope, `full-budget-${index}`, index.toString(16).padStart(64, "0"))
    )
    for (const [index, lease] of leases.entries()) {
      const namespaceDigest = createHash("sha256").update(`retained-${index}`).digest("hex")
      const storeKeyDigest = createHash("sha256").update(`store-${index}`).digest("hex")
      writeFileSync(
        getRetentionRecordPath(cacheDir, lease),
        `${JSON.stringify({ addresses: [{ namespaceDigest, storeKeyDigest }], ...lease, version: 3 })}\n`
      )
      await activateExtensionRuntimeCacheWriterLease(cacheDir, lease)
    }
    const currentLease = leases[0]!
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, {
      watchDirectory: () => ({ close: () => undefined }),
      writerLease: currentLease
    })

    const subscription = backend.subscribeStore(notionScope, () => undefined)
    await subscription.admission

    assert.equal(listRetentionRecords(cacheDir).length, leases.length)
    assert.equal(listWriterLeases(cacheDir).length, leases.length)
    assert.equal(
      readdirSync(cacheDir).some(
        (name) => CACHE_RETENTION_TEMP_PATTERN.test(name) || CACHE_WRITER_TEMP_PATTERN.test(name)
      ),
      false
    )
    const currentRecord = JSON.parse(
      readFileSync(getRetentionRecordPath(cacheDir, currentLease), "utf8")
    ) as { addresses: unknown[] }
    assert.equal(currentRecord.addresses.length, 2)
    subscription.unsubscribe()
    await backend.close()
  })
})

test("cache control budget rejects an extra writer without leaving a temp", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const leases = Array.from(
      { length: EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES * 2 },
      (_, index) =>
        createWriterLease(
          notionScope,
          `writer-budget-${index}`,
          index.toString(16).padStart(64, "0")
        )
    )
    for (const lease of leases) {
      await activateExtensionRuntimeCacheWriterLease(cacheDir, lease)
    }

    await assert.rejects(
      activateExtensionRuntimeCacheWriterLease(
        cacheDir,
        createWriterLease(notionScope, "writer-budget-overflow", "f".repeat(64))
      ),
      /control records exceeded their budget/
    )
    assert.equal(listWriterLeases(cacheDir).length, leases.length)
    assert.equal(
      readdirSync(cacheDir).some((name) => CACHE_WRITER_TEMP_PATTERN.test(name)),
      false
    )
  })
})

test("exact namespace retention survives unsubscribe and write revocation until process exit", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const scopes = Array.from(
      { length: EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES + 2 },
      (_, index) => ({
        ...notionScope,
        namespace: `retention-${index}`
      })
    ).sort((left, right) =>
      Buffer.compare(
        Buffer.from(basename(getCacheFilePathForScope(cacheDir, left))),
        Buffer.from(basename(getCacheFilePathForScope(cacheDir, right)))
      )
    )
    const pinnedScope = scopes[0]!
    const pinnedPath = getCacheFilePathForScope(cacheDir, pinnedScope)
    const emptyEnvelope = `${JSON.stringify({ mutationSequence: 0, stores: {}, version: 1 })}\n`
    for (const scope of scopes.slice(0, EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES)) {
      writeFileSync(getCacheFilePathForScope(cacheDir, scope), emptyEnvelope)
    }

    const readerLease = createWriterLease(pinnedScope, "retained-reader", "2".repeat(64))
    await activateExtensionRuntimeCacheWriterLease(cacheDir, readerLease)
    const reader = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease: readerLease })
    const subscription = reader.subscribeStore(pinnedScope, () => undefined)
    await subscription.admission
    subscription.unsubscribe()
    await revokeExtensionRuntimeCacheWrites(cacheDir, readerLease)

    const writerLease = createWriterLease(scopes.at(-2)!, "current-writer", "3".repeat(64))
    await activateExtensionRuntimeCacheWriterLease(cacheDir, writerLease)
    const writer = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease })
    writeEntries(writer, scopes.at(-2)!, [["page", "while-pinned"]])
    await writer.flush()
    assert.equal(existsSync(pinnedPath), true)

    await releaseExtensionRuntimeCacheRetention(cacheDir, readerLease)
    const afterExitScope = scopes.at(-1)!
    const afterExitLease = createWriterLease(
      afterExitScope,
      "current-writer-after-exit",
      "7".repeat(64)
    )
    await activateExtensionRuntimeCacheWriterLease(cacheDir, afterExitLease)
    const afterExitWriter = createFileExtensionRuntimeCacheBackend(cacheDir, {
      writerLease: afterExitLease
    })
    writeEntries(afterExitWriter, afterExitScope, [["page", "after-exit"]])
    await afterExitWriter.flush()
    assert.equal(existsSync(pinnedPath), false)

    await reader.close()
    await writer.close()
    await afterExitWriter.close()
  })
})

test("exact generation retention survives concurrent store GC until process exit", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const pinnedScope = createGenerationScope(1)
    const readerLease = createWriterLease(pinnedScope, "generation-reader", "4".repeat(64))
    await activateExtensionRuntimeCacheWriterLease(cacheDir, readerLease)
    const reader = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease: readerLease })
    writeEntries(reader, pinnedScope, [["page", "pinned-generation"]])
    await reader.flush()
    const subscription = reader.subscribeStore(pinnedScope, () => undefined)
    assert.equal((await subscription.admission).kind, "admitted")
    await revokeExtensionRuntimeCacheWrites(cacheDir, readerLease)

    const writers: RuntimeCacheBackend[] = []
    for (
      let generation = 2;
      generation <= EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE + 2;
      generation++
    ) {
      const generationScope = createGenerationScope(generation)
      const writerLease = createWriterLease(
        generationScope,
        `generation-writer-${generation}`,
        generation.toString(16).padStart(64, "0")
      )
      await activateExtensionRuntimeCacheWriterLease(cacheDir, writerLease)
      const writer = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease })
      writeEntries(writer, generationScope, [["page", `generation-${generation}`]])
      writers.push(writer)
    }
    await Promise.all(writers.map((writer) => writer.flush()))
    assert.deepEqual(reader.loadStore(pinnedScope), [["page", "pinned-generation"]])

    subscription.unsubscribe()
    const afterUnsubscribeScope = createGenerationScope(20)
    const afterUnsubscribeLease = createWriterLease(
      afterUnsubscribeScope,
      "generation-after-unsubscribe",
      "a".repeat(64)
    )
    await activateExtensionRuntimeCacheWriterLease(cacheDir, afterUnsubscribeLease)
    const afterUnsubscribeWriter = createFileExtensionRuntimeCacheBackend(cacheDir, {
      writerLease: afterUnsubscribeLease
    })
    writeEntries(afterUnsubscribeWriter, afterUnsubscribeScope, [["page", "after-unsubscribe"]])
    await afterUnsubscribeWriter.flush()
    assert.deepEqual(reader.loadStore(pinnedScope), [["page", "pinned-generation"]])

    await releaseExtensionRuntimeCacheRetention(cacheDir, readerLease)
    const afterExitScope = createGenerationScope(21)
    const afterExitLease = createWriterLease(
      afterExitScope,
      "generation-after-exit",
      "b".repeat(64)
    )
    await activateExtensionRuntimeCacheWriterLease(cacheDir, afterExitLease)
    const afterExitWriter = createFileExtensionRuntimeCacheBackend(cacheDir, {
      writerLease: afterExitLease
    })
    writeEntries(afterExitWriter, afterExitScope, [["page", "after-process-exit"]])
    await afterExitWriter.flush()
    assert.deepEqual(reader.loadStore(pinnedScope), [])

    await reader.close()
    await Promise.all(writers.map((writer) => writer.close()))
    await afterUnsubscribeWriter.close()
    await afterExitWriter.close()
  })
})

test("sync corruption recovery applies exact generation pins before store GC", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const pinnedScope = createGenerationScope(1)
    const pinnedStoreKey = encodeRuntimeCacheBackendScopeKey(pinnedScope)
    const lease = createWriterLease(pinnedScope, "generation-recovery", "8".repeat(64))
    await activateExtensionRuntimeCacheWriterLease(cacheDir, lease)
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, { writerLease: lease })
    writeEntries(backend, pinnedScope, [["page", "pinned-before-recovery"]])
    await backend.flush()
    const subscription = backend.subscribeStore(pinnedScope, () => undefined)
    assert.equal((await subscription.admission).kind, "admitted")
    subscription.unsubscribe()

    const stores: Record<string, unknown> = {
      [pinnedStoreKey]: {
        entries: [["page", "pinned-before-recovery"]],
        lastMutationSequence: 1
      }
    }
    for (
      let generation = 2;
      generation <= EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE + 1;
      generation++
    ) {
      stores[encodeRuntimeCacheBackendScopeKey(createGenerationScope(generation))] = {
        entries: [["page", `generation-${generation}`]],
        lastMutationSequence: generation
      }
    }
    stores.invalid = { entries: "invalid", lastMutationSequence: 1 }
    const cacheFilePath = getCacheFilePathForScope(cacheDir, pinnedScope)
    writeFileSync(
      cacheFilePath,
      `${JSON.stringify({
        mutationSequence: EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE + 1,
        stores,
        version: 1
      })}\n`
    )

    assert.deepEqual(backend.loadStore(pinnedScope), [["page", "pinned-before-recovery"]])
    const recovered = readCacheEnvelope(cacheFilePath)
    assert.equal(Object.keys(recovered.stores).length, EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE)
    assert.deepEqual(recovered.stores[pinnedStoreKey]?.entries, [
      ["page", "pinned-before-recovery"]
    ])
    assert.equal("invalid" in recovered.stores, false)

    await releaseExtensionRuntimeCacheRetention(cacheDir, lease)
    await backend.close()
  })
})

test("exact generation retention admission fails closed at the per-file store budget", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const admitted: Array<{
      backend: RuntimeCacheBackend
      subscription: ReturnType<RuntimeCacheBackend["subscribeStore"]>
    }> = []
    for (
      let generation = 1;
      generation <= EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE;
      generation++
    ) {
      const generationScope = createGenerationScope(generation)
      const lease = createWriterLease(
        generationScope,
        `generation-budget-${generation}`,
        generation.toString(16).padStart(64, "0")
      )
      await activateExtensionRuntimeCacheWriterLease(cacheDir, lease)
      const backend = createFileExtensionRuntimeCacheBackend(cacheDir, {
        watchDirectory: () => ({ close: () => undefined }),
        writerLease: lease
      })
      const subscription = backend.subscribeStore(generationScope, () => undefined)
      assert.equal((await subscription.admission).kind, "admitted")
      admitted.push({ backend, subscription })
    }

    const overflowScope = createGenerationScope(EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE + 1)
    const overflowLease = createWriterLease(
      overflowScope,
      "generation-budget-overflow",
      "f".repeat(64)
    )
    await activateExtensionRuntimeCacheWriterLease(cacheDir, overflowLease)
    const overflowBackend = createFileExtensionRuntimeCacheBackend(cacheDir, {
      watchDirectory: () => ({ close: () => undefined }),
      writerLease: overflowLease
    })
    const overflow = overflowBackend.subscribeStore(overflowScope, () => undefined)
    await assert.rejects(overflow.admission, /Extension runtime cache persistence failed/)
    assert.equal(listRetentionRecords(cacheDir).length, EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE)

    for (const { backend, subscription } of admitted) {
      subscription.unsubscribe()
      await backend.close()
    }
    await assert.rejects(overflowBackend.close(), /Extension runtime cache persistence failed/)
  })
})

test("cache change feed failure is bounded, terminal, and cancels its watcher", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const watchHub = new FakeRuntimeCacheWatchHub()
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, {
      watchDirectory: watchHub.watch
    })
    const failures: Error[] = []
    backend.onFailure((error) => failures.push(error))
    const subscription = backend.subscribeStore(notionScope, () => undefined)
    await subscription.admission

    watchHub.fail(new Error("raw watcher path and payload"))

    assert.equal(watchHub.activeWatcherCount, 0)
    assert.equal(failures.length, 1)
    assert.equal(failures[0]?.message, "Extension runtime cache persistence failed.")
    assert.equal(failures[0]?.message.includes("raw watcher"), false)
    await assert.rejects(backend.flush(), /Extension runtime cache persistence failed/)
    assert.throws(
      () => backend.subscribeStore(notionScope, () => undefined),
      /Extension runtime cache persistence failed/
    )
  })
})

test("cache change feed bounds active aggregate files behind one watcher", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const watchHub = new FakeRuntimeCacheWatchHub()
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, {
      watchDirectory: watchHub.watch
    })
    const subscriptions: ReturnType<RuntimeCacheBackend["subscribeStore"]>[] = []
    for (let index = 0; index < EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES; index++) {
      subscriptions.push(
        backend.subscribeStore(
          { ...notionScope, namespace: `bounded-live-namespace-${index}` },
          () => undefined
        )
      )
    }

    await Promise.all(subscriptions.map((subscription) => subscription.admission))

    assert.equal(watchHub.activeWatcherCount, 1)
    assert.throws(
      () =>
        backend.subscribeStore(
          { ...notionScope, namespace: "bounded-live-namespace-overflow" },
          () => undefined
        ),
      /change feed file limit exceeded/
    )

    for (const subscription of subscriptions) {
      subscription.unsubscribe()
    }
    assert.equal(watchHub.activeWatcherCount, 0)
    await backend.close()
  })
})

test("cache subscription does not replace an accepted local write with an older snapshot", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const watchHub = new FakeRuntimeCacheWatchHub()
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir, {
      watchDirectory: watchHub.watch
    })
    const snapshots: Array<{
      entries: readonly (readonly [string, string])[]
      revision: number
    }> = []

    writeEntries(backend, notionScope, [["page", "accepted-local-write"]])
    const subscription = backend.subscribeStore(notionScope, (snapshot) => {
      snapshots.push(structuredClone(snapshot))
    })

    assert.deepEqual(snapshots, [])
    await backend.flush()
    assert.deepEqual(await subscription.admission, {
      kind: "admitted",
      snapshot: { entries: [["page", "accepted-local-write"]], revision: 0 }
    })
    await settleCacheChangeFeed()
    assert.deepEqual(snapshots, [])

    subscription.unsubscribe()
    assert.equal(watchHub.activeWatcherCount, 0)
    await backend.close()
  })
})

test("throwing snapshot listeners do not poison persistence or block other listeners", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const watchHub = new FakeRuntimeCacheWatchHub()
    const writer = createFileExtensionRuntimeCacheBackend(cacheDir, {
      watchDirectory: watchHub.watch
    })
    const reader = createFileExtensionRuntimeCacheBackend(cacheDir, {
      watchDirectory: watchHub.watch
    })
    const persistenceFailures: Error[] = []
    const received: Array<readonly RuntimeCacheEntry[]> = []
    reader.onFailure((error) => persistenceFailures.push(error))
    const diagnostics: string[] = []
    const originalConsoleError = console.error
    console.error = (...args) => diagnostics.push(args.map(String).join(" "))
    let unsubscribeThrowing: () => void = () => undefined
    let unsubscribeReceiving: () => void = () => undefined
    try {
      const throwingSubscription = reader.subscribeStore(notionScope, () => {
        throw new Error("consumer callback failure")
      })
      const receivingSubscription = reader.subscribeStore(notionScope, (snapshot) => {
        received.push(structuredClone(snapshot.entries))
      })
      unsubscribeThrowing = throwingSubscription.unsubscribe
      unsubscribeReceiving = receivingSubscription.unsubscribe
      await Promise.all([throwingSubscription.admission, receivingSubscription.admission])
      writeEntries(writer, notionScope, [["page", "still-delivered"]])
      await writer.flush()
      watchHub.emit(basename(getCacheFilePathForScope(cacheDir, notionScope)))
      await waitForCacheCondition(() => received.at(-1)?.[0]?.[1] === "still-delivered")
      await reader.flush()
    } finally {
      unsubscribeReceiving()
      unsubscribeThrowing()
      console.error = originalConsoleError
    }

    assert.deepEqual(received.at(-1), [["page", "still-delivered"]])
    assert.deepEqual(persistenceFailures, [])
    assert.ok(diagnostics.length >= 1)
    assert.ok(
      diagnostics.every(
        (diagnostic) => diagnostic === "[jingle:extension-runtime] Cache snapshot listener failed."
      )
    )
    await writer.close()
    await reader.close()
  })
})

test("reentrant cache subscriptions preserve each registration revision order", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const watchHub = new FakeRuntimeCacheWatchHub()
    const writer = createFileExtensionRuntimeCacheBackend(cacheDir, {
      watchDirectory: watchHub.watch
    })
    const reader = createFileExtensionRuntimeCacheBackend(cacheDir, {
      watchDirectory: watchHub.watch
    })
    const firstRevisions: number[] = []
    const secondRevisions: number[] = []
    const reentrantRevisions: number[] = []
    let armReentrantSubscribe = false
    let unsubscribeReentrant: () => void = () => undefined
    const admissionPromises: Array<ReturnType<RuntimeCacheBackend["subscribeStore"]>["admission"]> =
      []
    const firstSubscription = reader.subscribeStore(notionScope, (snapshot) => {
      firstRevisions.push(snapshot.revision)
      if (armReentrantSubscribe) {
        armReentrantSubscribe = false
        const reentrantSubscription = reader.subscribeStore(notionScope, (nestedSnapshot) => {
          reentrantRevisions.push(nestedSnapshot.revision)
        })
        admissionPromises.push(reentrantSubscription.admission)
        unsubscribeReentrant = reentrantSubscription.unsubscribe
      }
    })
    const secondSubscription = reader.subscribeStore(notionScope, (snapshot) => {
      secondRevisions.push(snapshot.revision)
    })
    await Promise.all([firstSubscription.admission, secondSubscription.admission])
    armReentrantSubscribe = true

    writeEntries(writer, notionScope, [["page", "revision-order"]])
    await writer.flush()
    watchHub.emit(basename(getCacheFilePathForScope(cacheDir, notionScope)))
    await waitForCacheCondition(() => admissionPromises.length === 1)
    await Promise.all(admissionPromises)

    assert.deepEqual(firstRevisions.slice(-2), [2, 3])
    assert.deepEqual(secondRevisions.slice(-2), [2, 3])
    assert.ok(firstRevisions.length === 2 || firstRevisions.length === 3)
    assert.ok(secondRevisions.length === 2 || secondRevisions.length === 3)
    assert.deepEqual(reentrantRevisions, [])
    assertStrictlyIncreasing(firstRevisions)
    assertStrictlyIncreasing(secondRevisions)
    assertStrictlyIncreasing(reentrantRevisions)

    unsubscribeReentrant()
    secondSubscription.unsubscribe()
    firstSubscription.unsubscribe()
    await writer.close()
    await reader.close()
  })
})

test("duplicate cache keys recover through the durable corruption owner", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const initialBackend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(initialBackend, notionScope, [["page", "original"]])
    writeEntries(initialBackend, notionSecondaryScope, [["notification", "preserved"]])
    await initialBackend.flush()
    const cacheFilePath = getCacheFilePath(cacheDir)
    const cacheFile = JSON.parse(readFileSync(cacheFilePath, "utf8")) as {
      stores: Record<
        string,
        {
          entries: RuntimeCacheEntry[]
          lastMutationSequence: number
        }
      >
    }
    cacheFile.stores[encodeRuntimeCacheBackendScopeKey(notionScope)]!.entries = [
      ["page", "first-duplicate"],
      ["page", "second-duplicate"]
    ]
    writeFileSync(cacheFilePath, `${JSON.stringify(cacheFile, null, 2)}\n`)

    const watchHub = new FakeRuntimeCacheWatchHub()
    const recoveringBackend = createFileExtensionRuntimeCacheBackend(cacheDir, {
      watchDirectory: watchHub.watch
    })
    const snapshots: Array<readonly RuntimeCacheEntry[]> = []
    const diagnostics: string[] = []
    const originalConsoleError = console.error
    console.error = (...args) => diagnostics.push(args.map(String).join(" "))
    try {
      const subscription = recoveringBackend.subscribeStore(notionScope, (snapshot) => {
        snapshots.push(structuredClone(snapshot.entries))
      })
      assert.deepEqual(await subscription.admission, {
        kind: "admitted",
        snapshot: { entries: [], revision: 0 }
      })
    } finally {
      console.error = originalConsoleError
    }

    assert.deepEqual(snapshots, [])
    assert.deepEqual(recoveringBackend.loadStore(notionSecondaryScope), [
      ["notification", "preserved"]
    ])
    assert.deepEqual(diagnostics, [cacheCorruptionRecoveryDiagnostic])
    assert.match(readFileSync(`${cacheFilePath}.corrupt`, "utf8"), /first-duplicate/)
    assert.doesNotMatch(readFileSync(cacheFilePath, "utf8"), /first-duplicate/)
    await recoveringBackend.close()
  })
})

class FakeRuntimeCacheWatchHub {
  private readonly listeners = new Set<{
    onChange: (fileName: string | null) => void
    onError: (error: Error) => void
  }>()

  readonly watch: RuntimeCacheDirectoryWatch = (_directoryPath, listeners) => {
    this.listeners.add(listeners)
    return {
      close: () => {
        this.listeners.delete(listeners)
      }
    }
  }

  get activeWatcherCount(): number {
    return this.listeners.size
  }

  emit(fileName: string | null): void {
    for (const listeners of Array.from(this.listeners)) {
      listeners.onChange(fileName)
    }
  }

  fail(error: Error): void {
    for (const listeners of Array.from(this.listeners)) {
      listeners.onError(error)
    }
  }
}

async function settleCacheChangeFeed(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
}

async function waitForCacheCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) {
      return
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  assert.fail("Timed out waiting for the cache change feed")
}

function assertStrictlyIncreasing(revisions: readonly number[]): void {
  for (let index = 1; index < revisions.length; index++) {
    assert.ok(revisions[index]! > revisions[index - 1]!)
  }
}

function createScope(commandName: string): Parameters<RuntimeCacheBackend["loadStore"]>[0] {
  return {
    commandName,
    extensionName: "notion",
    identity: cacheIdentity,
    namespace: "recent-pages"
  }
}

function createGenerationScope(
  credentialGeneration: number
): Parameters<RuntimeCacheBackend["loadStore"]>[0] {
  return {
    ...notionScope,
    identity: {
      ...notionScope.identity,
      credentialGeneration
    }
  }
}

function createWriterLease(
  scope: RuntimeCacheBackendScope,
  sessionId: string,
  token: string
): ExtensionRuntimeCacheWriterLease {
  return {
    principal: {
      commandName: scope.commandName,
      extensionName: scope.extensionName,
      identity: scope.identity
    },
    sessionId,
    token
  }
}

function assertWriterPrincipalMismatch(error: unknown): boolean {
  assert.ok(error instanceof ExtensionRuntimeCacheWriterPrincipalError)
  assert.equal(error.code, "runtime_cache_writer_principal_mismatch")
  assert.equal(
    error.message,
    "Extension runtime cache scope is not owned by this writer principal."
  )
  return true
}

async function withCacheDirectory(callback: (cacheDir: string) => Promise<void>): Promise<void> {
  const cacheDir = mkdtempSync(join(tmpdir(), "jingle-runtime-cache-"))
  try {
    await callback(cacheDir)
  } finally {
    rmSync(cacheDir, { force: true, recursive: true })
  }
}

function getCacheFilePath(cacheDir: string): string {
  const cacheFile = readdirSync(cacheDir).find((name) => /^store-[a-f0-9]{64}\.json$/.test(name))
  assert.ok(cacheFile)
  return join(cacheDir, cacheFile)
}

function listRetentionRecords(cacheDir: string): string[] {
  return readdirSync(cacheDir).filter((name) => /^retention-lease-[a-f0-9]{64}\.json$/.test(name))
}

function listWriterLeases(cacheDir: string): string[] {
  return readdirSync(cacheDir).filter((name) => /^writer-lease-[a-f0-9]{64}\.json$/.test(name))
}

function getCacheFilePathForScope(
  cacheDir: string,
  scope: Parameters<RuntimeCacheBackend["loadStore"]>[0]
): string {
  const address = JSON.stringify([scope.extensionName, scope.namespace])
  const digest = createHash("sha256").update(address).digest("hex")
  return join(cacheDir, `store-${digest}.json`)
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

function listRegularCacheArtifacts(cacheDir: string): string[] {
  return readdirSync(cacheDir).filter((name) => {
    if (
      !/^store-[a-f0-9]{64}\.json(?:\.corrupt|(?:\.corrupt)?\.[0-9]+\.[0-9a-f-]{36}\.tmp)?$/.test(
        name
      )
    ) {
      return false
    }
    return lstatSync(join(cacheDir, name)).isFile()
  })
}

function assertCacheDirectoryQuota(cacheDir: string): void {
  const artifacts = listRegularCacheArtifacts(cacheDir)
  assert.ok(artifacts.length <= EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES)
  assert.ok(
    artifacts.reduce((total, name) => total + statSync(join(cacheDir, name)).size, 0) <=
      EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_BYTES
  )
}

function readCacheEnvelope(cacheFilePath: string): {
  mutationSequence: number
  stores: Record<
    string,
    { entries: readonly (readonly [string, string])[]; lastMutationSequence: number }
  >
  version: number
} {
  return JSON.parse(readFileSync(cacheFilePath, "utf8")) as {
    mutationSequence: number
    stores: Record<
      string,
      { entries: readonly (readonly [string, string])[]; lastMutationSequence: number }
    >
    version: number
  }
}

function writeEntries(
  backend: RuntimeCacheBackend,
  scope: Parameters<RuntimeCacheBackend["loadStore"]>[0],
  entries: readonly (readonly [string, string])[]
): void {
  backend.mutateStore(scope, {
    kind: "update",
    removeKeys: [],
    upsertEntries: entries
  })
}
