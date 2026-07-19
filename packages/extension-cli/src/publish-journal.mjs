import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, statSync } from "node:fs"
import { open, readFile, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { assertPublishLockHeld } from "./publish-lock.mjs"

const extensionPackageTemporaryDirectoryPrefix = ".jingle-extension-tmp-"
const journalSchemaVersion = 1
const transactionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const windowsFilesystemRetryCodes = new Set(["EACCES", "EBUSY", "EPERM"])

export async function beginPackagePublish(publishLock) {
  assertPublishLockHeld(publishLock)
  const packageRoot = readPublishLockTargetPath(publishLock)
  const packageParent = dirname(packageRoot)
  mkdirSync(packageParent, { recursive: true })
  const recovery = await reconcileInterruptedPackagePublish(publishLock)
  if (recovery.kind !== "none") {
    console.warn(`Reconciled interrupted extension publish (${recovery.kind}): ${packageRoot}`)
  }

  const transactionId = randomUUID()
  const transaction = createTransaction(packageRoot, publishLock.identity, transactionId)
  await writeJournal(transaction, publishLock)
  return transaction
}

export async function reconcileInterruptedPackagePublish(publishLock) {
  assertPublishLockHeld(publishLock)
  const packageRoot = readPublishLockTargetPath(publishLock)
  const journalPath = resolveJournalPath(packageRoot, publishLock.identity)
  const journalWritePath = resolveJournalWritePath(journalPath)

  await removePath(journalWritePath)
  if (!existsSync(journalPath)) {
    return { kind: "none" }
  }

  const transaction = await readJournal(packageRoot, publishLock.identity, journalPath)
  const packageState = readDirectoryState(transaction.packageRoot)
  const stagingState = readDirectoryState(transaction.stagingRoot)
  const backupState = readDirectoryState(transaction.backupRoot)

  if ([packageState, stagingState, backupState].includes("invalid")) {
    throw recoveryError(
      transaction,
      "publish recovery found a non-directory path where a package directory was expected"
    )
  }
  if (packageState === "directory" && stagingState === "directory" && backupState === "directory") {
    throw recoveryError(
      transaction,
      "publish recovery found final, staging, and backup directories at the same time"
    )
  }

  let kind = "discarded-incomplete"
  if (backupState === "directory" && packageState === "missing") {
    assertPublishLockHeld(publishLock)
    await renamePathWithRetry(transaction.backupRoot, transaction.packageRoot)
    if (stagingState === "directory") {
      assertPublishLockHeld(publishLock)
      await removePath(transaction.stagingRoot)
    }
    kind = "restored-previous"
  } else if (backupState === "directory") {
    assertPublishLockHeld(publishLock)
    await removePath(transaction.backupRoot)
    kind = "kept-published"
  } else if (stagingState === "directory") {
    assertPublishLockHeld(publishLock)
    await removePath(transaction.stagingRoot)
  } else if (packageState === "directory") {
    kind = "kept-published"
  }

  assertPublishLockHeld(publishLock)
  await removePath(transaction.journalPath)
  return { kind }
}

export async function publishPreparedPackage(transaction, publishLock) {
  assertTransactionOwnedByLock(transaction, publishLock)
  let previousArtifactMoved = false

  try {
    assertPublishLockHeld(publishLock)
    if (existsSync(transaction.packageRoot)) {
      await renamePathWithRetry(transaction.packageRoot, transaction.backupRoot)
      previousArtifactMoved = true
    }
    assertPublishLockHeld(publishLock)
    await renamePathWithRetry(transaction.stagingRoot, transaction.packageRoot)
  } catch (publishError) {
    if (previousArtifactMoved && !existsSync(transaction.packageRoot)) {
      try {
        assertPublishLockHeld(publishLock)
        await renamePathWithRetry(transaction.backupRoot, transaction.packageRoot)
      } catch (rollbackError) {
        const error = new AggregateError(
          [publishError, rollbackError],
          `Extension publish failed and rollback could not restore ${transaction.packageRoot}; previous artifact remains at ${transaction.backupRoot}`
        )
        error.code = "JINGLE_EXTENSION_PUBLISH_ROLLBACK_FAILED"
        error.publishedPackageRollback = {
          backupRoot: transaction.backupRoot,
          packageRoot: transaction.packageRoot
        }
        throw error
      }
    }
    throw publishError
  }

  if (previousArtifactMoved) {
    try {
      assertPublishLockHeld(publishLock)
    } catch (error) {
      error.publishedPackageRoot = transaction.packageRoot
      error.previousPackageBackupRoot = transaction.backupRoot
      throw error
    }
    try {
      await removePath(transaction.backupRoot)
    } catch (error) {
      console.warn(
        `Published extension but deferred interrupted-publish cleanup: ${transaction.packageRoot}`
      )
      console.warn(error instanceof Error ? error.message : String(error))
      return
    }
  }

  try {
    assertPublishLockHeld(publishLock)
    await removePath(transaction.journalPath)
  } catch (error) {
    console.warn(
      `Published extension but deferred interrupted-publish journal cleanup: ${transaction.packageRoot}`
    )
    console.warn(error instanceof Error ? error.message : String(error))
  }
}

export async function abandonPreparedPackage(transaction, publishLock) {
  assertTransactionOwnedByLock(transaction, publishLock)
  assertPublishLockHeld(publishLock)
  if (existsSync(transaction.stagingRoot)) {
    await removePath(transaction.stagingRoot)
  }
  if (!existsSync(transaction.backupRoot)) {
    await removePath(transaction.journalPath)
  }
}

export async function renamePathWithRetry(source, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination)
      return
    } catch (error) {
      if (!isWindowsFilesystemLockError(error) || attempt >= 5) {
        throw error
      }
      await delay((attempt + 1) * 100)
    }
  }
}

function createTransaction(packageRoot, targetIdentity, transactionId) {
  const packageParent = dirname(packageRoot)
  return {
    backupRoot: join(
      packageParent,
      `${extensionPackageTemporaryDirectoryPrefix}backup-${transactionId}`
    ),
    journalPath: resolveJournalPath(packageRoot, targetIdentity),
    packageRoot,
    stagingRoot: join(
      packageParent,
      `${extensionPackageTemporaryDirectoryPrefix}staging-${transactionId}`
    ),
    targetIdentity,
    transactionId
  }
}

async function writeJournal(transaction, publishLock) {
  assertTransactionOwnedByLock(transaction, publishLock)
  const journalWritePath = resolveJournalWritePath(transaction.journalPath)
  assertPublishLockHeld(publishLock)
  await removePath(journalWritePath)

  let file = null
  try {
    file = await open(journalWritePath, "wx", 0o600)
    await file.writeFile(
      `${JSON.stringify({
        schemaVersion: journalSchemaVersion,
        targetPath: transaction.packageRoot,
        transactionId: transaction.transactionId
      })}\n`,
      "utf8"
    )
    await file.sync()
  } finally {
    await file?.close()
  }

  assertPublishLockHeld(publishLock)
  await renamePathWithRetry(journalWritePath, transaction.journalPath)
}

async function readJournal(packageRoot, targetIdentity, journalPath) {
  let value
  try {
    value = JSON.parse(await readFile(journalPath, "utf8"))
  } catch (error) {
    throw recoveryError(
      { journalPath, packageRoot },
      `publish journal could not be decoded: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (!isRecord(value)) {
    throw recoveryError({ journalPath, packageRoot }, "publish journal must be an object")
  }
  const keys = Object.keys(value).sort()
  if (
    keys.length !== 3 ||
    keys[0] !== "schemaVersion" ||
    keys[1] !== "targetPath" ||
    keys[2] !== "transactionId"
  ) {
    throw recoveryError({ journalPath, packageRoot }, "publish journal has unknown fields")
  }
  if (value.schemaVersion !== journalSchemaVersion) {
    throw recoveryError({ journalPath, packageRoot }, "publish journal version is unsupported")
  }
  if (typeof value.transactionId !== "string" || !transactionIdPattern.test(value.transactionId)) {
    throw recoveryError({ journalPath, packageRoot }, "publish journal transactionId is invalid")
  }
  if (value.targetPath !== packageRoot) {
    throw recoveryError(
      { journalPath, packageRoot },
      "publish journal target does not match the held lock target"
    )
  }
  return createTransaction(packageRoot, targetIdentity, value.transactionId)
}

function resolveJournalPath(packageRoot, targetIdentity) {
  const packageIdentity = createHash("sha256").update(targetIdentity).digest("hex").slice(0, 32)
  return join(
    dirname(packageRoot),
    `${extensionPackageTemporaryDirectoryPrefix}journal-${packageIdentity}.json`
  )
}

function readPublishLockTargetPath(publishLock) {
  if (typeof publishLock.targetPath !== "string" || publishLock.targetPath.length === 0) {
    throw new Error("Extension publish lock does not own a canonical target path")
  }
  return publishLock.targetPath
}

function assertTransactionOwnedByLock(transaction, publishLock) {
  assertPublishLockHeld(publishLock)
  if (
    transaction.packageRoot !== readPublishLockTargetPath(publishLock) ||
    transaction.targetIdentity !== publishLock.identity
  ) {
    const error = new Error("Extension publish transaction does not belong to the held target lock")
    error.code = "JINGLE_EXTENSION_PUBLISH_TARGET_MISMATCH"
    throw error
  }
}

function resolveJournalWritePath(journalPath) {
  return `${journalPath}.writing`
}

function readDirectoryState(path) {
  if (!existsSync(path)) {
    return "missing"
  }
  try {
    return statSync(path).isDirectory() ? "directory" : "invalid"
  } catch {
    return "invalid"
  }
}

async function removePath(path) {
  await rm(path, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 })
}

function recoveryError(transaction, reason) {
  const error = new Error(
    `Extension publish recovery failed for ${transaction.packageRoot}: ${reason}. ` +
      `Inspect the ignored transaction journal before retrying: ${transaction.journalPath}`
  )
  error.code = "JINGLE_EXTENSION_PUBLISH_RECOVERY_FAILED"
  return error
}

function isWindowsFilesystemLockError(error) {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    windowsFilesystemRetryCodes.has(error.code)
  )
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
