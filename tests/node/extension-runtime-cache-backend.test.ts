import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { promisify } from "node:util"
import { createFileExtensionRuntimeCacheBackend } from "../../src/extension-runtime/cache-backend"
import type { RuntimeCacheBackend } from "@jingle/extension-api/host-runtime"

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

test("file runtime cache backend rejects corrupt files with a bounded public error", async () => {
  await withCacheDirectory(async (cacheDir) => {
    const backend = createFileExtensionRuntimeCacheBackend(cacheDir)
    writeEntries(backend, notionScope, [["page", "page-1"]])
    await backend.flush()
    const cacheFile = readdirSync(cacheDir).find((name) => name.endsWith(".json"))
    assert.ok(cacheFile)
    writeFileSync(join(cacheDir, cacheFile), '{"stores":')

    assert.throws(
      () => backend.loadStore(notionScope),
      (error) => {
        assert.ok(error instanceof Error)
        assert.equal(error.name, "ExtensionRuntimeCachePersistenceError")
        assert.equal(error.message, "Extension runtime cache persistence failed.")
        return true
      }
    )
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

test("file runtime cache backend recovers a fresh orphan lock after its stale boundary", async () => {
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
    await recoveringBackend.flush()

    assert.ok(Date.now() - startedAt >= 1_500)
    assert.deepEqual(recoveringBackend.loadStore(notionSecondaryScope), [
      ["notification", "notification-1"]
    ])
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

async function withCacheDirectory(callback: (cacheDir: string) => Promise<void>): Promise<void> {
  const cacheDir = mkdtempSync(join(tmpdir(), "jingle-runtime-cache-"))
  try {
    await callback(cacheDir)
  } finally {
    rmSync(cacheDir, { force: true, recursive: true })
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
