import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  beginPackagePublish,
  publishPreparedPackage,
  reconcileInterruptedPackagePublish
} from "../../packages/extension-cli/src/publish-journal.mjs"
import {
  acquirePublishLock,
  releasePublishLock
} from "../../packages/extension-cli/src/publish-lock.mjs"

test("publish journal restores the previous package after the final path becomes empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-extension-publish-journal-"))
  const packageRoot = join(root, "sample", "1.0.0")

  try {
    await writeMarker(packageRoot, "previous")
    const transaction = await withPublishLock(packageRoot, async (publishLock) => {
      const current = await beginPackagePublish(publishLock)
      await writeMarker(current.stagingRoot, "next")
      await rename(packageRoot, current.backupRoot)
      return current
    })

    const result = await withPublishLock(packageRoot, (publishLock) =>
      reconcileInterruptedPackagePublish(publishLock)
    )

    assert.deepEqual(result, { kind: "restored-previous" })
    assert.equal(await readMarker(packageRoot), "previous")
    assert.equal(await pathExists(transaction.stagingRoot), false)
    assert.equal(await pathExists(transaction.backupRoot), false)
    assert.equal(await pathExists(transaction.journalPath), false)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("publish journal keeps the promoted package and removes its stale backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-extension-publish-journal-"))
  const packageRoot = join(root, "sample", "1.0.0")

  try {
    await writeMarker(packageRoot, "previous")
    const transaction = await withPublishLock(packageRoot, async (publishLock) => {
      const current = await beginPackagePublish(publishLock)
      await writeMarker(current.stagingRoot, "next")
      await rename(packageRoot, current.backupRoot)
      await rename(current.stagingRoot, packageRoot)
      return current
    })

    const result = await withPublishLock(packageRoot, (publishLock) =>
      reconcileInterruptedPackagePublish(publishLock)
    )

    assert.deepEqual(result, { kind: "kept-published" })
    assert.equal(await readMarker(packageRoot), "next")
    assert.equal(await pathExists(transaction.backupRoot), false)
    assert.equal(await pathExists(transaction.journalPath), false)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("publish journal discards an interrupted first-build staging directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-extension-publish-journal-"))
  const packageRoot = join(root, "sample", "1.0.0")

  try {
    const transaction = await withPublishLock(packageRoot, async (publishLock) => {
      const current = await beginPackagePublish(publishLock)
      await writeMarker(current.stagingRoot, "partial")
      return current
    })

    const result = await withPublishLock(packageRoot, (publishLock) =>
      reconcileInterruptedPackagePublish(publishLock)
    )

    assert.deepEqual(result, { kind: "discarded-incomplete" })
    assert.equal(await pathExists(packageRoot), false)
    assert.equal(await pathExists(transaction.stagingRoot), false)
    assert.equal(await pathExists(transaction.journalPath), false)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("publish journal fails closed when its transaction identity is malformed", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-extension-publish-journal-"))
  const packageRoot = join(root, "sample", "1.0.0")

  try {
    const transaction = await withPublishLock(packageRoot, async (publishLock) => {
      const current = await beginPackagePublish(publishLock)
      await writeMarker(current.stagingRoot, "partial")
      await writeFile(
        current.journalPath,
        JSON.stringify({ schemaVersion: 1, transactionId: "../other-package" })
      )
      return current
    })

    await assert.rejects(
      () =>
        withPublishLock(packageRoot, (publishLock) =>
          reconcileInterruptedPackagePublish(publishLock)
        ),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "JINGLE_EXTENSION_PUBLISH_RECOVERY_FAILED"
    )
    assert.equal(await readMarker(transaction.stagingRoot), "partial")
    assert.equal(await pathExists(transaction.journalPath), true)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("publish journal follows the publish lock identity across a symlink alias", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-extension-publish-journal-"))
  const physicalOutputRoot = join(root, "physical")
  const aliasedOutputRoot = join(root, "alias")
  const physicalPackageRoot = join(physicalOutputRoot, "sample", "1.0.0")
  const aliasedPackageRoot = join(aliasedOutputRoot, "sample", "1.0.0")

  try {
    await mkdir(physicalOutputRoot, { recursive: true })
    await symlink(
      physicalOutputRoot,
      aliasedOutputRoot,
      process.platform === "win32" ? "junction" : "dir"
    )
    await writeMarker(physicalPackageRoot, "previous")
    const transaction = await withPublishLock(aliasedPackageRoot, async (publishLock) => {
      const current = await beginPackagePublish(publishLock)
      await writeMarker(current.stagingRoot, "next")
      await rename(physicalPackageRoot, current.backupRoot)
      return current
    })

    const result = await withPublishLock(physicalPackageRoot, (publishLock) =>
      reconcileInterruptedPackagePublish(publishLock)
    )

    assert.deepEqual(result, { kind: "restored-previous" })
    assert.equal(await readMarker(physicalPackageRoot), "previous")
    assert.equal(await pathExists(transaction.stagingRoot), false)
    assert.equal(await pathExists(transaction.backupRoot), false)
    assert.equal(await pathExists(transaction.journalPath), false)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test(
  "publish journal rejects a different case-preserving target behind the same folded lock identity",
  { skip: process.platform !== "darwin" && process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "jingle-extension-publish-journal-"))
    const upperPackageRoot = join(root, "sample", "1.0.0-RC")
    const lowerPackageRoot = join(root, "sample", "1.0.0-rc")

    try {
      const transaction = await withPublishLock(upperPackageRoot, async (publishLock) => {
        const current = await beginPackagePublish(publishLock)
        await writeMarker(current.stagingRoot, "upper")
        return current
      })

      await assert.rejects(
        () =>
          withPublishLock(lowerPackageRoot, (publishLock) =>
            reconcileInterruptedPackagePublish(publishLock)
          ),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "JINGLE_EXTENSION_PUBLISH_RECOVERY_FAILED"
      )
      assert.equal(await readMarker(transaction.stagingRoot), "upper")
      assert.equal(await pathExists(transaction.journalPath), true)
      assert.equal(await pathExists(upperPackageRoot), false)
      assert.equal(await pathExists(lowerPackageRoot), false)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  }
)

test("publish transaction rejects a different target lock before mutating paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-extension-publish-journal-"))
  const firstPackageRoot = join(root, "first", "1.0.0")
  const secondPackageRoot = join(root, "second", "1.0.0")

  try {
    const firstLock = await acquirePublishLock(firstPackageRoot)
    const secondLock = await acquirePublishLock(secondPackageRoot)
    try {
      const transaction = await beginPackagePublish(firstLock)
      await writeMarker(transaction.stagingRoot, "next")

      await assert.rejects(
        () => publishPreparedPackage(transaction, secondLock),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "JINGLE_EXTENSION_PUBLISH_TARGET_MISMATCH"
      )
      assert.equal(await readMarker(transaction.stagingRoot), "next")
      assert.equal(await pathExists(firstPackageRoot), false)
      assert.equal(await pathExists(secondPackageRoot), false)
    } finally {
      await releasePublishLock(secondLock, secondLock.ownerToken)
      await releasePublishLock(firstLock, firstLock.ownerToken)
    }
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

async function withPublishLock<T>(
  packageRoot: string,
  operation: (publishLock: Awaited<ReturnType<typeof acquirePublishLock>>) => Promise<T>
): Promise<T> {
  const publishLock = await acquirePublishLock(packageRoot)
  try {
    return await operation(publishLock)
  } finally {
    await releasePublishLock(publishLock, publishLock.ownerToken)
  }
}

async function writeMarker(root: string, value: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, "marker.txt"), value)
}

async function readMarker(root: string): Promise<string> {
  return readFile(join(root, "marker.txt"), "utf8")
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
