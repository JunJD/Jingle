import assert from "node:assert/strict"
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import test from "node:test"
import {
  beginPackagePublish,
  publishPreparedPackage,
  reconcileInterruptedPackagePublish,
  reconcileInterruptedPackagePublishes
} from "../../packages/extension-cli/src/publish-journal.mjs"
import {
  parseInstalledExtensionId,
  parseInstalledExtensionPackageRoot,
  parseInstalledExtensionVersion,
  resolveCanonicalInstalledExtensionPackageRoot,
  resolveInstalledExtensionPackageRoot
} from "../../packages/extension-cli/src/installed-package-path.mjs"
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

test("publish scanner treats a journal deleted after enumeration as converged", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-extension-publish-journal-"))
  const packageRoot = join(root, "sample", "1.0.0")

  try {
    const transaction = (await withPublishLock(packageRoot, (publishLock) =>
      beginPackagePublish(publishLock)
    )) as PublishTransaction
    let deleted = false

    await reconcileInterruptedPackagePublishes(root, {
      readFile: async (path: string, encoding: BufferEncoding) => {
        if (path === transaction.journalPath && !deleted) {
          deleted = true
          await rm(path)
        }
        return readFile(path, encoding)
      },
      readdir,
      realpath
    })

    assert.equal(deleted, true)
    assert.equal(await pathExists(transaction.journalPath), false)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("publish scanner treats a journal deleted after its first read as converged", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-extension-publish-journal-"))
  const packageRoot = join(root, "sample", "1.0.0")

  try {
    const transaction = (await withPublishLock(packageRoot, (publishLock) =>
      beginPackagePublish(publishLock)
    )) as PublishTransaction
    let deleted = false

    await reconcileInterruptedPackagePublishes(root, {
      readFile: async (path: string, encoding: BufferEncoding) => {
        const source = await readFile(path, encoding)
        if (path === transaction.journalPath && !deleted) {
          deleted = true
          await rm(path)
        }
        return source
      },
      readdir,
      realpath
    })

    assert.equal(deleted, true)
    assert.equal(await pathExists(transaction.journalPath), false)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("publish scanner fails closed after reading a malformed journal", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-extension-publish-journal-"))
  const packageRoot = join(root, "sample", "1.0.0")

  try {
    const transaction = (await withPublishLock(packageRoot, (publishLock) =>
      beginPackagePublish(publishLock)
    )) as PublishTransaction
    await writeFile(transaction.journalPath, "{malformed")

    await assert.rejects(() => reconcileInterruptedPackagePublishes(root), hasRecoveryFailureCode)
    assert.equal(await pathExists(transaction.journalPath), true)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("publish scanner ignores broken and vanished foreign entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-extension-publish-journal-"))
  const brokenEntry = join(root, "broken-entry")
  const vanishedEntry = join(root, "vanished-entry")

  try {
    await mkdir(root, { recursive: true })
    await symlink(
      join(root, "missing-target"),
      brokenEntry,
      process.platform === "win32" ? "junction" : "dir"
    )
    await mkdir(vanishedEntry)
    let removed = false

    await reconcileInterruptedPackagePublishes(root, {
      readFile,
      readdir,
      realpath: async (path: string) => {
        if (basename(path) === "vanished-entry" && !removed) {
          removed = true
          await rm(vanishedEntry, { recursive: true })
        }
        return realpath(path)
      }
    })

    assert.equal(removed, true)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("installed package paths require a flat lowercase id and canonical SemVer", () => {
  const root = join(tmpdir(), "jingle-extension-package-path")

  assert.equal(parseInstalledExtensionId("apple-reminders"), "apple-reminders")
  assert.equal(parseInstalledExtensionVersion("1.0.0-beta.1"), "1.0.0-beta.1")
  assert.equal(parseInstalledExtensionVersion("1.0.0+build.1"), "1.0.0+build.1")
  assert.deepEqual(
    parseInstalledExtensionPackageRoot(root, join(root, "apple-reminders", "1.0.0")),
    {
      id: "apple-reminders",
      packageRoot: resolveInstalledExtensionPackageRoot(root, {
        id: "apple-reminders",
        version: "1.0.0"
      }),
      version: "1.0.0"
    }
  )

  for (const id of ["@jingle/apple-reminders", "nested/id", "nested\\id", "Apple", "a--b"]) {
    assert.throws(() => parseInstalledExtensionId(id), hasPackagePathFailureCode)
  }
  for (const version of ["v1.0.0", "01.0.0", "1.0.0-RC", "1.0.0/next", "1.0.0\\next"]) {
    assert.throws(() => parseInstalledExtensionVersion(version), hasPackagePathFailureCode)
  }
  for (const packageRoot of [
    join(root, "apple-reminders", "nested", "1.0.0"),
    join(root, "..", "escape", "1.0.0"),
    join(root, "Apple", "1.0.0")
  ]) {
    assert.throws(
      () => parseInstalledExtensionPackageRoot(root, packageRoot),
      hasPackagePathFailureCode
    )
  }
})

test("installed package target rejects a symlink or junction escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-extension-package-path-"))
  const outsideRoot = await mkdtemp(join(tmpdir(), "jingle-extension-package-outside-"))

  try {
    await symlink(
      outsideRoot,
      join(root, "sample"),
      process.platform === "win32" ? "junction" : "dir"
    )

    await assert.rejects(
      () =>
        resolveCanonicalInstalledExtensionPackageRoot(root, {
          id: "sample",
          version: "1.0.0"
        }),
      hasPackagePathFailureCode
    )
  } finally {
    await rm(root, { force: true, recursive: true })
    await rm(outsideRoot, { force: true, recursive: true })
  }
})

test("publish scanner rejects nested and escaping journal targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "jingle-extension-publish-journal-"))
  const packageRoot = join(root, "sample", "1.0.0")

  try {
    const transaction = (await withPublishLock(packageRoot, (publishLock) =>
      beginPackagePublish(publishLock)
    )) as PublishTransaction
    for (const targetPath of [
      join(root, "sample", "nested", "1.0.0"),
      join(root, "..", "escape", "1.0.0")
    ]) {
      await writeFile(
        transaction.journalPath,
        `${JSON.stringify({
          schemaVersion: 1,
          targetPath,
          transactionId: transaction.transactionId
        })}\n`
      )
      await assert.rejects(() => reconcileInterruptedPackagePublishes(root), hasRecoveryFailureCode)
    }
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

interface PublishTransaction {
  journalPath: string
  transactionId: string
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

function hasPackagePathFailureCode(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "JINGLE_EXTENSION_PACKAGE_PATH_INVALID"
  )
}

function hasRecoveryFailureCode(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "JINGLE_EXTENSION_PUBLISH_RECOVERY_FAILED"
  )
}
