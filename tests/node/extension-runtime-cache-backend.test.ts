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
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { promisify } from "node:util"
import {
  createFileExtensionRuntimeCacheBackend,
  EXTENSION_RUNTIME_CACHE_MAX_ACTIVE_FILE_BYTES,
  EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES,
  EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_BYTES,
  EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES,
  EXTENSION_RUNTIME_CACHE_MAX_FILE_SET_BYTES,
  EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE,
  writeRuntimeCacheBufferFully,
  writeRuntimeCacheBufferFullySync
} from "../../src/extension-runtime/cache-backend"
import { createExtensionRuntimeCacheLifecycle } from "../../src/extension-runtime/cache-lifecycle"
import {
  encodeRuntimeCacheBackendScopeKey,
  type RuntimeCacheBackend
} from "@jingle/extension-api/host-runtime"

const cacheIdentity = {
  commandConfigGeneration: 1,
  connectionConfigGeneration: 2,
  connectionId: "workspace",
  credentialGeneration: 3,
  extensionConfigGeneration: 4,
  kind: "available" as const,
  runtimeArtifactRevision: "sha256:artifact",
  runtimePackageRevision: "1.2.3"
}

const notionScope = createScope("search-page")
const notionSecondaryScope = createScope("notifications")
const execFileAsync = promisify(execFile)
const cacheCorruptionRecoveryDiagnostic =
  "[jingle:extension-runtime] Extension runtime cache corruption was recovered."

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
      const { createFileExtensionRuntimeCacheBackend } = require(${JSON.stringify(
        resolve("src/extension-runtime/cache-backend.ts")
      )});
      const identity = ${JSON.stringify(cacheIdentity)};
      void (async () => {
        const backend = createFileExtensionRuntimeCacheBackend(process.env.CACHE_DIR);
        for (let index = 0; index < 12; index++) {
          backend.mutateStore({
            commandName: "search-page",
            extensionName: "notion",
            identity,
            namespace: "shared-process-cache"
          }, {
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
      const { createFileExtensionRuntimeCacheBackend } = require(${JSON.stringify(
        resolve("src/extension-runtime/cache-backend.ts")
      )});
      const identity = ${JSON.stringify(cacheIdentity)};
      void (async () => {
        const backend = createFileExtensionRuntimeCacheBackend(process.env.CACHE_DIR);
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
    }
    await backend.flush()

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
    }
    await currentBackend.flush()
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
      onPersistenceFailure: (sessionId) => persistenceFailures.push(sessionId)
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
    const cacheFile = readdirSync(cacheDir).find((name) => name.endsWith(".json"))
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

async function withCacheDirectory(callback: (cacheDir: string) => Promise<void>): Promise<void> {
  const cacheDir = mkdtempSync(join(tmpdir(), "jingle-runtime-cache-"))
  try {
    await callback(cacheDir)
  } finally {
    rmSync(cacheDir, { force: true, recursive: true })
  }
}

function getCacheFilePath(cacheDir: string): string {
  const cacheFile = readdirSync(cacheDir).find((name) => name.endsWith(".json"))
  assert.ok(cacheFile)
  return join(cacheDir, cacheFile)
}

function getCacheFilePathForScope(
  cacheDir: string,
  scope: Parameters<RuntimeCacheBackend["loadStore"]>[0]
): string {
  const address = JSON.stringify([scope.extensionName, scope.namespace])
  const digest = createHash("sha256").update(address).digest("hex")
  return join(cacheDir, `store-${digest}.json`)
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
