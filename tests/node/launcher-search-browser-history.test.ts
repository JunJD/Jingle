import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { access, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { promisify } from "node:util"
import {
  BrowserHistorySnapshotLeaseManager,
  queryChromiumHistoryRows,
  type BrowserHistorySnapshotLeaseManagerOptions
} from "../../src/main/services/launcher-search/providers/browser-history"

const execFileAsync = promisify(execFile)

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for browser history snapshot state.")
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function listSnapshotDirectories(snapshotRoot: string): Promise<string[]> {
  return (await readdir(snapshotRoot)).filter((entry) =>
    entry.startsWith("jingle-browser-history-")
  )
}

async function copyHistoryDatabase(
  params: Parameters<
    NonNullable<BrowserHistorySnapshotLeaseManagerOptions["copyHistoryDatabase"]>
  >[0]
): Promise<void> {
  const { historyPath, signal, tempDirectory } = params
  signal.throwIfAborted()
  const snapshotPath = join(tempDirectory, "History")
  await copyFile(historyPath, snapshotPath)

  for (const suffix of ["-wal", "-shm"]) {
    try {
      await copyFile(`${historyPath}${suffix}`, `${snapshotPath}${suffix}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }
  }
  signal.throwIfAborted()
}

async function createHistoryDatabase(historyPath: string): Promise<void> {
  await mkdir(dirname(historyPath), { recursive: true })
  await execFileAsync("/usr/bin/sqlite3", [
    historyPath,
    `
      CREATE TABLE urls (
        id INTEGER PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT,
        visit_count INTEGER NOT NULL,
        last_visit_time INTEGER NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES
        ('https://example.com/alpha', 'Alpha guide', 5, 13390000000000000, 0),
        ('https://example.com/beta', 'Beta notes', 3, 13380000000000000, 0);
    `
  ])
}

test("browser history queries reuse one fingerprinted snapshot across a search burst", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-browser-history-test-"))
  const historyPath = join(root, "profile", "History")
  const snapshotRoot = join(root, "snapshots")
  await mkdir(snapshotRoot)
  await createHistoryDatabase(historyPath)
  let copyCount = 0
  let now = 1_000
  const manager = new BrowserHistorySnapshotLeaseManager({
    copyHistoryDatabase: async (params) => {
      copyCount += 1
      await copyHistoryDatabase(params)
    },
    now: () => now,
    snapshotTtlMs: 10_000,
    tempDirectoryRoot: snapshotRoot
  })

  try {
    const signal = new AbortController().signal
    assert.equal(
      (
        await queryChromiumHistoryRows({
          historyPath,
          limit: 10,
          query: "ALPHA",
          signal,
          snapshotLeaseManager: manager
        })
      )[0]?.title,
      "Alpha guide"
    )
    assert.equal(
      (
        await queryChromiumHistoryRows({
          historyPath,
          limit: 10,
          query: "beta",
          signal,
          snapshotLeaseManager: manager
        })
      )[0]?.title,
      "Beta notes"
    )
    assert.equal(copyCount, 1)
    assert.equal((await listSnapshotDirectories(snapshotRoot)).length, 1)

    await execFileAsync("/usr/bin/sqlite3", [
      historyPath,
      "INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES ('https://example.com/gamma', 'Gamma plan', 8, 13395000000000000, 0);"
    ])
    assert.equal(
      (
        await queryChromiumHistoryRows({
          historyPath,
          limit: 10,
          query: "gamma",
          signal,
          snapshotLeaseManager: manager
        })
      )[0]?.title,
      "Gamma plan"
    )
    assert.equal(copyCount, 2)
    assert.equal((await listSnapshotDirectories(snapshotRoot)).length, 1)

    now = 11_001
    await queryChromiumHistoryRows({
      historyPath,
      limit: 10,
      query: "gamma",
      signal,
      snapshotLeaseManager: manager
    })
    assert.equal(copyCount, 3)
    assert.equal((await listSnapshotDirectories(snapshotRoot)).length, 1)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("snapshot replacement keeps an active reader alive and includes sidecars in identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-browser-history-test-"))
  const historyPath = join(root, "profile", "History")
  const snapshotRoot = join(root, "snapshots")
  await mkdir(dirname(historyPath), { recursive: true })
  await mkdir(snapshotRoot)
  await writeFile(historyPath, "history-v1")
  let now = 1_000
  const manager = new BrowserHistorySnapshotLeaseManager({
    now: () => now,
    snapshotTtlMs: 10_000,
    tempDirectoryRoot: snapshotRoot
  })

  try {
    const signal = new AbortController().signal
    const firstLease = await manager.acquire(historyPath, signal)
    await writeFile(`${historyPath}-wal`, "wal-v1")
    const secondLease = await manager.acquire(historyPath, signal)

    assert.notEqual(firstLease.snapshotPath, secondLease.snapshotPath)
    await access(firstLease.snapshotPath)
    assert.equal((await listSnapshotDirectories(snapshotRoot)).length, 2)

    await firstLease.release()
    await assert.rejects(access(firstLease.snapshotPath), { code: "ENOENT" })
    assert.equal((await listSnapshotDirectories(snapshotRoot)).length, 1)

    now = 20_000
    await secondLease.release()
    await waitFor(async () => (await listSnapshotDirectories(snapshotRoot)).length === 0)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("concurrent snapshot readers share construction while caller cancellation stays isolated", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-browser-history-test-"))
  const historyPath = join(root, "profile", "History")
  const snapshotRoot = join(root, "snapshots")
  await mkdir(dirname(historyPath), { recursive: true })
  await mkdir(snapshotRoot)
  await writeFile(historyPath, "history")
  const copyGate = createDeferred()
  let copyCount = 0
  let now = 1_000
  const manager = new BrowserHistorySnapshotLeaseManager({
    copyHistoryDatabase: async (params) => {
      copyCount += 1
      await copyGate.promise
      await copyHistoryDatabase(params)
    },
    now: () => now,
    snapshotTtlMs: 10_000,
    tempDirectoryRoot: snapshotRoot
  })

  try {
    const firstController = new AbortController()
    const secondController = new AbortController()
    const firstAcquire = manager.acquire(historyPath, firstController.signal)
    const secondAcquire = manager.acquire(historyPath, secondController.signal)
    await waitFor(() => copyCount === 1)

    firstController.abort(new Error("first caller cancelled"))
    await assert.rejects(firstAcquire, /first caller cancelled/)
    copyGate.resolve()

    const secondLease = await secondAcquire
    assert.equal(copyCount, 1)
    await access(secondLease.snapshotPath)

    now = 20_000
    await secondLease.release()
    await waitFor(async () => (await listSnapshotDirectories(snapshotRoot)).length === 0)
  } finally {
    copyGate.resolve()
    await rm(root, { force: true, recursive: true })
  }
})

test("stale generation hands its successful waiter a live reader lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-browser-history-test-"))
  const historyPath = join(root, "profile", "History")
  const snapshotRoot = join(root, "snapshots")
  await mkdir(dirname(historyPath), { recursive: true })
  await mkdir(snapshotRoot)
  await writeFile(historyPath, "history")
  const copyGates = [createDeferred(), createDeferred()]
  let copyCount = 0
  let fingerprint = "generation-a"
  let now = 1_000
  const manager = new BrowserHistorySnapshotLeaseManager({
    copyHistoryDatabase: async (params) => {
      const copyIndex = copyCount
      copyCount += 1
      await copyGates[copyIndex]?.promise
      await copyHistoryDatabase(params)
    },
    now: () => now,
    readFingerprint: async () => fingerprint,
    snapshotTtlMs: 10_000,
    tempDirectoryRoot: snapshotRoot
  })

  try {
    const signal = new AbortController().signal
    const firstAcquire = manager.acquire(historyPath, signal)
    await waitFor(() => copyCount === 1)

    fingerprint = "generation-b"
    const secondAcquire = manager.acquire(historyPath, signal)
    await waitFor(() => copyCount === 2)

    fingerprint = "generation-a"
    copyGates[0]?.resolve()
    const firstLease = await firstAcquire
    await access(firstLease.snapshotPath)
    await firstLease.release()

    fingerprint = "generation-b"
    copyGates[1]?.resolve()
    const secondLease = await secondAcquire
    await access(secondLease.snapshotPath)
    assert.equal(copyCount, 2)

    now = 20_000
    await secondLease.release()
    await waitFor(async () => (await listSnapshotDirectories(snapshotRoot)).length === 0)
  } finally {
    for (const gate of copyGates) {
      gate.resolve()
    }
    await rm(root, { force: true, recursive: true })
  }
})

test("snapshot cleanup failure stays observable and does not replace a successful query", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-browser-history-test-"))
  const historyPath = join(root, "profile", "History")
  const snapshotRoot = join(root, "snapshots")
  await mkdir(snapshotRoot)
  await createHistoryDatabase(historyPath)
  let cleanupErrors = 0
  let removeAttempts = 0
  const manager = new BrowserHistorySnapshotLeaseManager({
    onCleanupError: () => {
      cleanupErrors += 1
    },
    removeDirectory: async (directoryPath) => {
      removeAttempts += 1
      if (removeAttempts === 1) {
        const error = new Error("cleanup denied")
        ;(error as NodeJS.ErrnoException).code = "EACCES"
        throw error
      }
      await rm(directoryPath, { force: true, recursive: true })
    },
    snapshotTtlMs: 0,
    tempDirectoryRoot: snapshotRoot
  })

  try {
    const signal = new AbortController().signal
    const firstRows = await queryChromiumHistoryRows({
      historyPath,
      limit: 10,
      query: "alpha",
      signal,
      snapshotLeaseManager: manager
    })
    assert.equal(firstRows[0]?.title, "Alpha guide")
    assert.equal(cleanupErrors, 1)
    assert.equal((await listSnapshotDirectories(snapshotRoot)).length, 1)

    const secondRows = await queryChromiumHistoryRows({
      historyPath,
      limit: 10,
      query: "beta",
      signal,
      snapshotLeaseManager: manager
    })
    assert.equal(secondRows[0]?.title, "Beta notes")
    assert.equal(cleanupErrors, 1)
    assert.equal((await listSnapshotDirectories(snapshotRoot)).length, 0)
  } finally {
    await manager.dispose()
    await rm(root, { force: true, recursive: true })
  }
})

test("persistent snapshot cleanup failure applies backpressure before copying again", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-browser-history-cleanup-pressure-"))
  const snapshotRoot = join(root, "snapshots")
  await mkdir(snapshotRoot)
  let copyCount = 0
  let removeAttempts = 0
  const manager = new BrowserHistorySnapshotLeaseManager({
    copyHistoryDatabase: async () => {
      copyCount += 1
    },
    onCleanupError: () => undefined,
    readFingerprint: async () => "stable-fingerprint",
    removeDirectory: async () => {
      removeAttempts += 1
      const error = new Error("cleanup denied")
      ;(error as NodeJS.ErrnoException).code = "EACCES"
      throw error
    },
    snapshotTtlMs: 0,
    tempDirectoryRoot: snapshotRoot
  })
  let blockedAcquisitions = 0
  let successfulAcquisitions = 0

  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const lease = await manager.acquire(
          join(root, "profile", "History"),
          new AbortController().signal
        )
        successfulAcquisitions += 1
        await lease.release()
      } catch (error) {
        assert.match(String(error), /cleanup is blocked/)
        blockedAcquisitions += 1
      }
    }

    assert.deepEqual(
      {
        blockedAcquisitions,
        copyCount,
        removeAttempts,
        retainedDirectories: (await listSnapshotDirectories(snapshotRoot)).length,
        successfulAcquisitions
      },
      {
        blockedAcquisitions: 19,
        copyCount: 1,
        removeAttempts: 20,
        retainedDirectories: 1,
        successfulAcquisitions: 1
      }
    )
  } finally {
    manager.disposeSync()
    await rm(root, { force: true, recursive: true })
  }
})

test("cleanup backpressure preserves valid current snapshots and live pending builds", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-browser-history-cleanup-reuse-"))
  const snapshotRoot = join(root, "snapshots")
  const cachedHistoryPath = join(root, "cached", "History")
  const cleanupFailurePath = join(root, "cleanup-failure", "History")
  const pendingHistoryPath = join(root, "pending", "History")
  const pendingCopyGate = createDeferred()
  const copyCounts = new Map<string, number>()
  await mkdir(snapshotRoot)
  const manager = new BrowserHistorySnapshotLeaseManager({
    copyHistoryDatabase: async ({ historyPath }) => {
      copyCounts.set(historyPath, (copyCounts.get(historyPath) ?? 0) + 1)
      if (historyPath === cleanupFailurePath) {
        throw new Error("copy failed")
      }
      if (historyPath === pendingHistoryPath) {
        await pendingCopyGate.promise
      }
    },
    onCleanupError: () => undefined,
    readFingerprint: async (historyPath) => `fingerprint:${historyPath}`,
    removeDirectory: async () => {
      throw new Error("cleanup denied")
    },
    snapshotTtlMs: 10_000,
    tempDirectoryRoot: snapshotRoot
  })

  try {
    const signal = new AbortController().signal
    const cachedLease = await manager.acquire(cachedHistoryPath, signal)
    await cachedLease.release()
    const firstPendingAcquire = manager.acquire(pendingHistoryPath, signal)
    await waitFor(() => copyCounts.get(pendingHistoryPath) === 1)
    await assert.rejects(manager.acquire(cleanupFailurePath, signal), /copy failed/)

    const cachedReuse = await manager.acquire(cachedHistoryPath, signal)
    assert.equal(cachedReuse.snapshotPath, cachedLease.snapshotPath)
    await cachedReuse.release()

    const secondPendingAcquire = manager.acquire(pendingHistoryPath, signal)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(copyCounts.get(pendingHistoryPath), 1)
    pendingCopyGate.resolve()
    const [firstPendingLease, secondPendingLease] = await Promise.all([
      firstPendingAcquire,
      secondPendingAcquire
    ])
    assert.equal(firstPendingLease.snapshotPath, secondPendingLease.snapshotPath)
    await firstPendingLease.release()
    await secondPendingLease.release()
  } finally {
    pendingCopyGate.resolve()
    manager.disposeSync()
    await rm(root, { force: true, recursive: true })
  }
})

test("an aborted pending build must settle before a replacement starts", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-browser-history-pending-abort-"))
  const snapshotRoot = join(root, "snapshots")
  const pendingHistoryPath = join(root, "pending", "History")
  const pendingCopyGate = createDeferred()
  let pendingCopyCount = 0
  await mkdir(snapshotRoot)
  const manager = new BrowserHistorySnapshotLeaseManager({
    copyHistoryDatabase: async () => {
      pendingCopyCount += 1
      await pendingCopyGate.promise
    },
    readFingerprint: async (historyPath) => `fingerprint:${historyPath}`,
    tempDirectoryRoot: snapshotRoot
  })

  try {
    const pendingController = new AbortController()
    const pendingAcquire = manager.acquire(pendingHistoryPath, pendingController.signal)
    await waitFor(() => pendingCopyCount === 1)
    pendingController.abort(new Error("pending caller cancelled"))
    await assert.rejects(pendingAcquire, /pending caller cancelled/)

    await assert.rejects(
      manager.acquire(pendingHistoryPath, new AbortController().signal),
      /cancellation is still pending/
    )
    assert.equal(pendingCopyCount, 1)

    pendingCopyGate.resolve()
    let replacementLease: Awaited<ReturnType<typeof manager.acquire>> | undefined
    await waitFor(async () => {
      try {
        replacementLease = await manager.acquire(pendingHistoryPath, new AbortController().signal)
        return true
      } catch (error) {
        assert.match(String(error), /cancellation is still pending/)
        return false
      }
    })
    assert.equal(pendingCopyCount, 2)
    await replacementLease?.release()
  } finally {
    pendingCopyGate.resolve()
    manager.disposeSync()
    await rm(root, { force: true, recursive: true })
  }
})

test("dispose stops new leases but waits for active readers before cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-browser-history-test-"))
  const historyPath = join(root, "profile", "History")
  const snapshotRoot = join(root, "snapshots")
  await mkdir(dirname(historyPath), { recursive: true })
  await mkdir(snapshotRoot)
  await writeFile(historyPath, "history")
  const manager = new BrowserHistorySnapshotLeaseManager({ tempDirectoryRoot: snapshotRoot })

  try {
    const lease = await manager.acquire(historyPath, new AbortController().signal)
    await manager.dispose()
    await access(lease.snapshotPath)
    await assert.rejects(
      manager.acquire(historyPath, new AbortController().signal),
      /manager is disposed/
    )

    await lease.release()
    await waitFor(async () => (await listSnapshotDirectories(snapshotRoot)).length === 0)
  } finally {
    manager.disposeSync()
    await rm(root, { force: true, recursive: true })
  }
})

test("dispose rejects an acquisition that is still reading its source fingerprint", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-browser-history-test-"))
  const historyPath = join(root, "profile", "History")
  const snapshotRoot = join(root, "snapshots")
  await mkdir(dirname(historyPath), { recursive: true })
  await mkdir(snapshotRoot)
  await writeFile(historyPath, "history")
  const fingerprintStarted = createDeferred()
  const fingerprintGate = createDeferred()
  const manager = new BrowserHistorySnapshotLeaseManager({
    readFingerprint: async () => {
      fingerprintStarted.resolve()
      await fingerprintGate.promise
      return "fingerprint"
    },
    tempDirectoryRoot: snapshotRoot
  })

  try {
    const acquire = manager.acquire(historyPath, new AbortController().signal)
    await fingerprintStarted.promise
    await manager.dispose()
    fingerprintGate.resolve()

    await assert.rejects(acquire, /manager is disposed/)
    assert.equal((await listSnapshotDirectories(snapshotRoot)).length, 0)
  } finally {
    fingerprintGate.resolve()
    manager.disposeSync()
    await rm(root, { force: true, recursive: true })
  }
})

test("aborted and failed snapshot builds remove their temporary directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-browser-history-test-"))
  const historyPath = join(root, "profile", "History")
  const snapshotRoot = join(root, "snapshots")
  await mkdir(dirname(historyPath), { recursive: true })
  await mkdir(snapshotRoot)
  await writeFile(historyPath, "history")

  try {
    const manager = new BrowserHistorySnapshotLeaseManager({
      copyHistoryDatabase: ({ signal }) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        }),
      tempDirectoryRoot: snapshotRoot
    })
    const controller = new AbortController()
    const acquire = manager.acquire(historyPath, controller.signal)
    await waitFor(async () => (await listSnapshotDirectories(snapshotRoot)).length === 1)
    controller.abort(new Error("only caller cancelled"))
    await assert.rejects(acquire, /only caller cancelled/)
    await waitFor(async () => (await listSnapshotDirectories(snapshotRoot)).length === 0)

    const failingManager = new BrowserHistorySnapshotLeaseManager({
      copyHistoryDatabase: async () => {
        throw new Error("copy failed")
      },
      tempDirectoryRoot: snapshotRoot
    })
    await assert.rejects(
      failingManager.acquire(historyPath, new AbortController().signal),
      /copy failed/
    )
    await waitFor(async () => (await listSnapshotDirectories(snapshotRoot)).length === 0)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("snapshot construction retries when the source changes during copy", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-browser-history-test-"))
  const historyPath = join(root, "profile", "History")
  const snapshotRoot = join(root, "snapshots")
  await mkdir(dirname(historyPath), { recursive: true })
  await mkdir(snapshotRoot)
  await writeFile(historyPath, "history-v1")
  let copyCount = 0
  let now = 1_000
  const manager = new BrowserHistorySnapshotLeaseManager({
    copyHistoryDatabase: async (params) => {
      copyCount += 1
      await copyHistoryDatabase(params)
      if (copyCount === 1) {
        await writeFile(historyPath, "history-v2")
      }
    },
    now: () => now,
    snapshotTtlMs: 10_000,
    tempDirectoryRoot: snapshotRoot
  })

  try {
    const lease = await manager.acquire(historyPath, new AbortController().signal)
    assert.equal(copyCount, 2)
    assert.equal((await listSnapshotDirectories(snapshotRoot)).length, 1)

    now = 20_000
    await lease.release()
    await waitFor(async () => (await listSnapshotDirectories(snapshotRoot)).length === 0)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
