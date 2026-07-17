import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
  writeFileSync,
  type Stats
} from "node:fs"
import { lstat, mkdir, open, readFile, readdir, rename, rm, unlink } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import * as properLockfile from "proper-lockfile"
import {
  encodeRuntimeCacheBackendScopeKey,
  type RuntimeCacheBackend,
  type RuntimeCacheBackendFailureListener,
  type RuntimeCacheBackendMutation,
  type RuntimeCacheBackendScope,
  type RuntimeCacheEntry
} from "@jingle/extension-api/host-runtime"

interface RuntimeCacheFileStoreShape {
  entries: RuntimeCacheEntry[]
  lastMutationSequence: number
}

interface RuntimeCacheFileShape {
  mutationSequence: number
  stores: Record<string, RuntimeCacheFileStoreShape>
  version: typeof RUNTIME_CACHE_FILE_VERSION
}

interface RuntimeCacheFileBackendOptions {
  lock?: {
    retryCount: number
    retryTimeoutMs: number
    staleMs: number
    updateMs: number
  }
}

export const EXTENSION_RUNTIME_CACHE_DIR_ENV = "JINGLE_EXTENSION_RUNTIME_CACHE_DIR"

const CACHE_LOCK_STALE_MS = 30_000
const RUNTIME_CACHE_FILE_VERSION = 1
// Production consumers use the SDK's 10 MiB default store. Keep several warm generations while
// bounding each aggregate file and one atomic corruption-evidence replacement.
export const EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE = 8
export const EXTENSION_RUNTIME_CACHE_MAX_ACTIVE_FILE_BYTES = 64 * 1024 * 1024
export const EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES = 16 * 1024 * 1024
export const EXTENSION_RUNTIME_CACHE_MAX_FILE_SET_BYTES =
  EXTENSION_RUNTIME_CACHE_MAX_ACTIVE_FILE_BYTES + EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES
// Directory retention is intentionally address-agnostic: it bounds derived artifacts without
// decoding a digest back into an extension, namespace, or lifecycle owner.
export const EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES = 32
export const EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_BYTES = 256 * 1024 * 1024
const CACHE_CORRUPTION_RECOVERY_DIAGNOSTIC =
  "[jingle:extension-runtime] Extension runtime cache corruption was recovered."
const CACHE_PERSISTENCE_ERROR_MESSAGE = "Extension runtime cache persistence failed."
const DEFAULT_LOCK_OPTIONS = {
  retryCount: 400,
  retryTimeoutMs: 100,
  staleMs: CACHE_LOCK_STALE_MS,
  updateMs: CACHE_LOCK_STALE_MS / 3
} as const
const ACTIVE_CACHE_FILE_PATTERN = /^store-([a-f0-9]{64})\.json$/
const CORRUPT_CACHE_FILE_PATTERN = /^store-([a-f0-9]{64})\.json\.corrupt$/
const CACHE_TEMPORARY_FILE_PATTERN =
  /^store-([a-f0-9]{64})\.json(?:\.corrupt)?\.[0-9]+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/

const lockSync = (
  properLockfile as typeof properLockfile & {
    lockSync: (
      filePath: string,
      options: {
        onCompromised: (error: Error) => void
        realpath: false
        retries: 0
        stale: number
        update: number
      }
    ) => () => void
  }
).lockSync

export function createFileExtensionRuntimeCacheBackend(
  cacheDir: string,
  options: RuntimeCacheFileBackendOptions = {}
): RuntimeCacheBackend {
  const failureListeners = new Set<RuntimeCacheBackendFailureListener>()
  let closeViolation: Error | null = null
  let failure: Error | null = null
  let failureReported = false
  let acceptingWrites = true
  let writeQueue = Promise.resolve()

  const drainWrites = async (): Promise<void> => {
    let pendingWrites: Promise<void>
    do {
      pendingWrites = writeQueue
      await pendingWrites
    } while (pendingWrites !== writeQueue)
    const terminalFailure = failure ?? closeViolation
    if (terminalFailure) {
      throw terminalFailure
    }
  }

  const reportFailure = (error: Error): void => {
    if (failureReported) {
      return
    }
    failureReported = true
    for (const listener of failureListeners) {
      notifyFailureListener(listener, error)
    }
  }

  const recordFailure = (error: unknown): Error => {
    if (!failure) {
      failure = toCachePersistenceError(error)
      reportFailure(failure)
    }
    return failure
  }

  const recordCloseViolation = (): Error => {
    if (!closeViolation) {
      closeViolation = toCachePersistenceError(
        new Error("Extension runtime cache backend is closed.")
      )
      reportFailure(closeViolation)
    }
    return closeViolation
  }

  return {
    async close() {
      acceptingWrites = false
      await drainWrites()
    },
    flush: drainWrites,
    loadStore(scope) {
      const cacheFilePath = getStoreFilePath(cacheDir, scope)
      try {
        const result = readCacheFileWithRecoverySync(
          cacheDir,
          cacheFilePath,
          options.lock ?? DEFAULT_LOCK_OPTIONS
        )
        if (result.corruption) {
          reportCacheCorruptionRecovery()
        }
        return result.cacheFile.stores[encodeRuntimeCacheBackendScopeKey(scope)]?.entries ?? []
      } catch (error) {
        throw toCachePersistenceError(error)
      }
    },
    mutateStore(scope, mutation) {
      if (!acceptingWrites) {
        throw failure ?? recordCloseViolation()
      }
      if (failure) {
        throw failure
      }

      const cacheFilePath = getStoreFilePath(cacheDir, scope)
      const storeKey = encodeRuntimeCacheBackendScopeKey(scope)
      const mutationSnapshot = cloneMutation(mutation)
      writeQueue = writeQueue
        .then(async () => {
          if (failure) {
            throw failure
          }
          await updateCacheFile(
            cacheDir,
            cacheFilePath,
            storeKey,
            mutationSnapshot,
            options.lock ?? DEFAULT_LOCK_OPTIONS,
            reportCacheCorruptionRecovery
          )
        })
        .catch((error: unknown) => {
          throw recordFailure(error)
        })
      void writeQueue.catch(() => undefined)
    },
    onFailure(listener) {
      failureListeners.add(listener)
      const currentDiagnostic = failure ?? closeViolation
      if (currentDiagnostic) {
        notifyFailureListener(listener, currentDiagnostic)
      }
      return () => {
        failureListeners.delete(listener)
      }
    }
  }
}

async function updateCacheFile(
  cacheDir: string,
  cacheFilePath: string,
  storeKey: string,
  mutation: RuntimeCacheBackendMutation,
  lockOptions: NonNullable<RuntimeCacheFileBackendOptions["lock"]>,
  reportRecovery: () => void
): Promise<void> {
  await mkdir(cacheDir, { recursive: true })
  let directoryCompromisedError: Error | null = null
  let compromisedError: Error | null = null
  let recoveredCorruption: ExtensionRuntimeCacheCorruptionError | null = null
  const releaseDirectory = await acquireCacheLock(cacheDir, lockOptions, (error) => {
    directoryCompromisedError = error
  })
  let releaseFile: (() => Promise<void>) | null = null

  try {
    // Every writer and recovery path takes the directory lock before its aggregate-file lock.
    assertLockIsOwned(directoryCompromisedError)
    releaseFile = await acquireCacheLock(cacheFilePath, lockOptions, (error) => {
      compromisedError = error
    })
    assertLockIsOwned(directoryCompromisedError)
    assertLockIsOwned(compromisedError)
    const protectedPaths = new Set([cacheFilePath, `${cacheFilePath}.corrupt`])
    await convergeCacheDirectoryQuota(cacheDir, protectedPaths)
    assertLockIsOwned(directoryCompromisedError)
    assertLockIsOwned(compromisedError)
    const result = await readCacheFileForUpdate(cacheFilePath)
    recoveredCorruption = result.corruption
    const cacheFile = result.cacheFile
    const currentEntries = cacheFile.stores[storeKey]?.entries ?? []
    if (cacheFile.mutationSequence === Number.MAX_SAFE_INTEGER) {
      throw new RangeError("Extension runtime cache mutation sequence is exhausted.")
    }
    const nextSequence = cacheFile.mutationSequence + 1
    const stores = { ...cacheFile.stores }
    if (mutation.kind === "clear") {
      delete stores[storeKey]
    } else {
      stores[storeKey] = {
        entries: applyMutation(currentEntries, mutation),
        lastMutationSequence: nextSequence
      }
    }
    const nextCacheFile = retainCacheFile(
      {
        mutationSequence: nextSequence,
        stores,
        version: RUNTIME_CACHE_FILE_VERSION
      },
      mutation.kind === "clear" ? null : storeKey
    )
    assertLockIsOwned(directoryCompromisedError)
    assertLockIsOwned(compromisedError)
    if (result.corruption) {
      await reserveCacheArtifactReplacement(
        cacheDir,
        cacheFilePath,
        `${cacheFilePath}.corrupt`,
        EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES,
        protectedPaths
      )
      assertLockIsOwned(directoryCompromisedError)
      assertLockIsOwned(compromisedError)
      await quarantineCacheFile(cacheFilePath, EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES)
    } else {
      await boundQuarantineFile(
        cacheDir,
        cacheFilePath,
        EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES,
        protectedPaths,
        () => {
          assertLockIsOwned(directoryCompromisedError)
          assertLockIsOwned(compromisedError)
        }
      )
    }

    assertLockIsOwned(directoryCompromisedError)
    assertLockIsOwned(compromisedError)
    if (Object.keys(nextCacheFile.stores).length === 0) {
      await removeCurrentCacheFile(cacheFilePath)
      await syncDirectory(cacheDir)
    } else {
      const serializedCacheFile = serializeCacheFile(nextCacheFile)
      await convergeCacheDirectoryQuota(cacheDir, protectedPaths, {
        bytes: Buffer.byteLength(serializedCacheFile),
        files: 1
      })
      assertLockIsOwned(directoryCompromisedError)
      assertLockIsOwned(compromisedError)
      await writeCacheFileAtomically(cacheFilePath, serializedCacheFile)
    }
    await convergeCacheDirectoryQuota(cacheDir, protectedPaths)
    assertLockIsOwned(directoryCompromisedError)
    assertLockIsOwned(compromisedError)
  } finally {
    try {
      await releaseFile?.()
    } finally {
      await releaseDirectory()
    }
  }

  if (recoveredCorruption) {
    reportRecovery()
  }
}

async function acquireCacheLock(
  path: string,
  lockOptions: NonNullable<RuntimeCacheFileBackendOptions["lock"]>,
  onCompromised: (error: Error) => void
): Promise<() => Promise<void>> {
  return properLockfile.lock(path, {
    onCompromised: (error) => {
      onCompromised(error)
    },
    realpath: false,
    retries: {
      factor: 1,
      maxTimeout: lockOptions.retryTimeoutMs,
      minTimeout: lockOptions.retryTimeoutMs,
      randomize: true,
      retries: lockOptions.retryCount
    },
    stale: lockOptions.staleMs,
    update: lockOptions.updateMs
  })
}

function cloneMutation(mutation: RuntimeCacheBackendMutation): RuntimeCacheBackendMutation {
  return mutation.kind === "clear"
    ? mutation
    : {
        kind: "update",
        removeKeys: [...mutation.removeKeys],
        upsertEntries: mutation.upsertEntries.map(([key, data]) => [key, data] as const)
      }
}

function applyMutation(
  currentEntries: readonly RuntimeCacheEntry[],
  mutation: RuntimeCacheBackendMutation
): RuntimeCacheEntry[] {
  if (mutation.kind === "clear") {
    return []
  }

  const entries = new Map(currentEntries)
  for (const key of mutation.removeKeys) {
    entries.delete(key)
  }
  for (const [key, data] of mutation.upsertEntries) {
    entries.delete(key)
    entries.set(key, data)
  }
  return Array.from(entries)
}

function assertLockIsOwned(compromisedError: Error | null): void {
  if (compromisedError) {
    throw compromisedError
  }
}

async function readCacheFileForUpdate(cacheFilePath: string): Promise<{
  cacheFile: RuntimeCacheFileShape
  corruption: ExtensionRuntimeCacheCorruptionError | null
}> {
  try {
    await assertRegularCacheArtifact(cacheFilePath)
    return {
      cacheFile: parseCacheFile(await readFile(cacheFilePath, "utf8"), false),
      corruption: null
    }
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return { cacheFile: createEmptyCacheFile(), corruption: null }
    }
    if (error instanceof ExtensionRuntimeCacheCorruptionError) {
      return { cacheFile: error.recoveredFile, corruption: error }
    }
    throw error
  }
}

function readCacheFileWithRecoverySync(
  cacheDir: string,
  cacheFilePath: string,
  lockOptions: NonNullable<RuntimeCacheFileBackendOptions["lock"]>
): {
  cacheFile: RuntimeCacheFileShape
  corruption: ExtensionRuntimeCacheCorruptionError | null
} {
  try {
    return { cacheFile: readCacheFile(cacheFilePath), corruption: null }
  } catch (error) {
    if (!(error instanceof ExtensionRuntimeCacheCorruptionError)) {
      throw error
    }
  }

  mkdirSync(cacheDir, { recursive: true })
  let directoryCompromisedError: Error | null = null
  let compromisedError: Error | null = null
  const releaseDirectory = acquireCacheLockSync(cacheDir, lockOptions, (error) => {
    directoryCompromisedError = error
  })
  let releaseFile: (() => void) | null = null
  let result: {
    cacheFile: RuntimeCacheFileShape
    corruption: ExtensionRuntimeCacheCorruptionError | null
  }

  try {
    assertLockIsOwned(directoryCompromisedError)
    releaseFile = acquireCacheLockSync(cacheFilePath, lockOptions, (error) => {
      compromisedError = error
    })
    assertLockIsOwned(directoryCompromisedError)
    assertLockIsOwned(compromisedError)
    const protectedPaths = new Set([cacheFilePath, `${cacheFilePath}.corrupt`])
    convergeCacheDirectoryQuotaSync(cacheDir, protectedPaths)
    assertLockIsOwned(directoryCompromisedError)
    assertLockIsOwned(compromisedError)
    try {
      result = { cacheFile: readCacheFile(cacheFilePath), corruption: null }
    } catch (error) {
      if (!(error instanceof ExtensionRuntimeCacheCorruptionError)) {
        throw error
      }
      const recoveredFile = retainCacheFile(error.recoveredFile, null)
      assertLockIsOwned(directoryCompromisedError)
      assertLockIsOwned(compromisedError)
      reserveCacheArtifactReplacementSync(
        cacheDir,
        cacheFilePath,
        `${cacheFilePath}.corrupt`,
        EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES,
        protectedPaths
      )
      assertLockIsOwned(directoryCompromisedError)
      assertLockIsOwned(compromisedError)
      quarantineCacheFileSync(cacheFilePath, EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES)
      const serializedCacheFile = serializeCacheFile(recoveredFile)
      convergeCacheDirectoryQuotaSync(cacheDir, protectedPaths, {
        bytes: Buffer.byteLength(serializedCacheFile),
        files: 1
      })
      assertLockIsOwned(directoryCompromisedError)
      assertLockIsOwned(compromisedError)
      writeCacheFileAtomicallySync(cacheFilePath, serializedCacheFile)
      convergeCacheDirectoryQuotaSync(cacheDir, protectedPaths)
      assertLockIsOwned(directoryCompromisedError)
      assertLockIsOwned(compromisedError)
      result = { cacheFile: recoveredFile, corruption: error }
    }
  } finally {
    try {
      releaseFile?.()
    } finally {
      releaseDirectory()
    }
  }

  return result
}

function acquireCacheLockSync(
  path: string,
  lockOptions: NonNullable<RuntimeCacheFileBackendOptions["lock"]>,
  onCompromised: (error: Error) => void
): () => void {
  return lockSync(path, {
    onCompromised,
    realpath: false,
    retries: 0,
    stale: lockOptions.staleMs,
    update: lockOptions.updateMs
  })
}

interface RuntimeCacheDirectoryReservation {
  bytes: number
  files: number
}

interface RuntimeCacheDirectoryArtifact {
  digest: string
  kind: "active" | "corrupt" | "temporary"
  path: string
  size: number
}

async function reserveCacheArtifactReplacement(
  cacheDir: string,
  sourcePath: string,
  destinationPath: string,
  maxBytes: number,
  protectedPaths: ReadonlySet<string>
): Promise<void> {
  const source = await assertRegularCacheArtifact(sourcePath)
  await assertRegularCacheArtifactOrMissing(destinationPath)
  await convergeCacheDirectoryQuota(
    cacheDir,
    new Set([...protectedPaths, sourcePath, destinationPath]),
    { bytes: Math.min(source.size, maxBytes), files: 1 }
  )
}

function reserveCacheArtifactReplacementSync(
  cacheDir: string,
  sourcePath: string,
  destinationPath: string,
  maxBytes: number,
  protectedPaths: ReadonlySet<string>
): void {
  const source = assertRegularCacheArtifactSync(sourcePath)
  assertRegularCacheArtifactOrMissingSync(destinationPath)
  convergeCacheDirectoryQuotaSync(
    cacheDir,
    new Set([...protectedPaths, sourcePath, destinationPath]),
    { bytes: Math.min(source.size, maxBytes), files: 1 }
  )
}

async function convergeCacheDirectoryQuota(
  cacheDir: string,
  protectedPaths: ReadonlySet<string>,
  reservation: RuntimeCacheDirectoryReservation = { bytes: 0, files: 0 }
): Promise<void> {
  assertCacheDirectoryReservation(reservation)
  let artifacts = await scanCacheDirectoryArtifacts(cacheDir)
  let changed = false
  for (const artifact of artifacts) {
    if (artifact.kind === "temporary" && !protectedPaths.has(artifact.path)) {
      changed = (await removeRecognizedRegularFile(artifact.path)) || changed
    }
  }
  artifacts = await scanCacheDirectoryArtifacts(cacheDir)
  assertProtectedCacheBudget(artifacts, protectedPaths, reservation)

  const candidates = createCacheArtifactEvictionCandidates(artifacts, protectedPaths)
  let totals = measureCacheDirectoryArtifacts(artifacts)
  while (exceedsCacheDirectoryQuota(totals, reservation)) {
    const candidate = candidates.shift()
    if (!candidate) {
      throw new RangeError("Extension runtime cache directory exceeded its retention budget.")
    }
    for (const artifact of candidate) {
      changed = (await removeRecognizedRegularFile(artifact.path)) || changed
    }
    totals = measureCacheDirectoryArtifacts(await scanCacheDirectoryArtifacts(cacheDir))
  }
  if (changed) {
    await syncDirectory(cacheDir)
  }
}

function convergeCacheDirectoryQuotaSync(
  cacheDir: string,
  protectedPaths: ReadonlySet<string>,
  reservation: RuntimeCacheDirectoryReservation = { bytes: 0, files: 0 }
): void {
  assertCacheDirectoryReservation(reservation)
  let artifacts = scanCacheDirectoryArtifactsSync(cacheDir)
  let changed = false
  for (const artifact of artifacts) {
    if (artifact.kind === "temporary" && !protectedPaths.has(artifact.path)) {
      changed = removeRecognizedRegularFileSync(artifact.path) || changed
    }
  }
  artifacts = scanCacheDirectoryArtifactsSync(cacheDir)
  assertProtectedCacheBudget(artifacts, protectedPaths, reservation)

  const candidates = createCacheArtifactEvictionCandidates(artifacts, protectedPaths)
  let totals = measureCacheDirectoryArtifacts(artifacts)
  while (exceedsCacheDirectoryQuota(totals, reservation)) {
    const candidate = candidates.shift()
    if (!candidate) {
      throw new RangeError("Extension runtime cache directory exceeded its retention budget.")
    }
    for (const artifact of candidate) {
      changed = removeRecognizedRegularFileSync(artifact.path) || changed
    }
    totals = measureCacheDirectoryArtifacts(scanCacheDirectoryArtifactsSync(cacheDir))
  }
  if (changed) {
    syncDirectorySync(cacheDir)
  }
}

function assertCacheDirectoryReservation(reservation: RuntimeCacheDirectoryReservation): void {
  if (
    !Number.isSafeInteger(reservation.bytes) ||
    reservation.bytes < 0 ||
    !Number.isSafeInteger(reservation.files) ||
    reservation.files < 0 ||
    reservation.bytes > EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_BYTES ||
    reservation.files > EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES
  ) {
    throw new RangeError("Extension runtime cache directory reservation is invalid.")
  }
}

function assertProtectedCacheBudget(
  artifacts: readonly RuntimeCacheDirectoryArtifact[],
  protectedPaths: ReadonlySet<string>,
  reservation: RuntimeCacheDirectoryReservation
): void {
  const protectedTotals = measureCacheDirectoryArtifacts(
    artifacts.filter((artifact) => protectedPaths.has(artifact.path))
  )
  if (exceedsCacheDirectoryQuota(protectedTotals, reservation)) {
    throw new RangeError("Extension runtime cache directory cannot retain the current operation.")
  }
}

function createCacheArtifactEvictionCandidates(
  artifacts: readonly RuntimeCacheDirectoryArtifact[],
  protectedPaths: ReadonlySet<string>
): RuntimeCacheDirectoryArtifact[][] {
  const groups = new Map<string, RuntimeCacheDirectoryArtifact[]>()
  for (const artifact of artifacts) {
    const group = groups.get(artifact.digest) ?? []
    group.push(artifact)
    groups.set(artifact.digest, group)
  }
  return Array.from(groups.entries())
    .filter(([, group]) => group.every((artifact) => !protectedPaths.has(artifact.path)))
    .sort(([left], [right]) => compareStoreKeys(left, right))
    .map(([, group]) => group)
}

function measureCacheDirectoryArtifacts(artifacts: readonly RuntimeCacheDirectoryArtifact[]): {
  bytes: number
  files: number
} {
  let bytes = 0
  for (const artifact of artifacts) {
    bytes += artifact.size
    if (!Number.isSafeInteger(bytes)) {
      throw new RangeError("Extension runtime cache directory size is invalid.")
    }
  }
  return { bytes, files: artifacts.length }
}

function exceedsCacheDirectoryQuota(
  totals: RuntimeCacheDirectoryReservation,
  reservation: RuntimeCacheDirectoryReservation
): boolean {
  return (
    totals.files + reservation.files > EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES ||
    totals.bytes + reservation.bytes > EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_BYTES
  )
}

async function scanCacheDirectoryArtifacts(
  cacheDir: string
): Promise<RuntimeCacheDirectoryArtifact[]> {
  const artifacts: RuntimeCacheDirectoryArtifact[] = []
  for (const name of await readdir(cacheDir)) {
    const identity = readCacheArtifactIdentity(name)
    if (!identity) {
      continue
    }
    const path = join(cacheDir, name)
    try {
      const status = await lstat(path)
      if (status.isFile()) {
        assertCacheArtifactSize(status.size)
        artifacts.push({ ...identity, path, size: status.size })
      }
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        throw error
      }
    }
  }
  return artifacts
}

function scanCacheDirectoryArtifactsSync(cacheDir: string): RuntimeCacheDirectoryArtifact[] {
  const artifacts: RuntimeCacheDirectoryArtifact[] = []
  for (const name of readdirSync(cacheDir)) {
    const identity = readCacheArtifactIdentity(name)
    if (!identity) {
      continue
    }
    const path = join(cacheDir, name)
    try {
      const status = lstatSync(path)
      if (status.isFile()) {
        assertCacheArtifactSize(status.size)
        artifacts.push({ ...identity, path, size: status.size })
      }
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        throw error
      }
    }
  }
  return artifacts
}

function readCacheArtifactIdentity(
  name: string
): Pick<RuntimeCacheDirectoryArtifact, "digest" | "kind"> | null {
  const activeMatch = ACTIVE_CACHE_FILE_PATTERN.exec(name)
  if (activeMatch) {
    return { digest: activeMatch[1], kind: "active" }
  }
  const corruptMatch = CORRUPT_CACHE_FILE_PATTERN.exec(name)
  if (corruptMatch) {
    return { digest: corruptMatch[1], kind: "corrupt" }
  }
  const temporaryMatch = CACHE_TEMPORARY_FILE_PATTERN.exec(name)
  return temporaryMatch ? { digest: temporaryMatch[1], kind: "temporary" } : null
}

function assertCacheArtifactSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeError("Extension runtime cache artifact size is invalid.")
  }
}

async function removeRecognizedRegularFile(path: string): Promise<boolean> {
  try {
    if (!(await lstat(path)).isFile()) {
      return false
    }
    await unlink(path)
    return true
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return false
    }
    throw error
  }
}

function removeRecognizedRegularFileSync(path: string): boolean {
  try {
    if (!lstatSync(path).isFile()) {
      return false
    }
    unlinkSync(path)
    return true
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return false
    }
    throw error
  }
}

async function removeCurrentCacheFile(cacheFilePath: string): Promise<void> {
  try {
    await assertRegularCacheArtifact(cacheFilePath)
    await unlink(cacheFilePath)
  } catch (error) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      throw error
    }
  }
}

async function assertRegularCacheArtifact(path: string): Promise<Stats> {
  const status = await lstat(path)
  if (!status.isFile()) {
    throw new Error("Extension runtime cache artifact is not a regular file.")
  }
  return status
}

function assertRegularCacheArtifactSync(path: string): Stats {
  const status = lstatSync(path)
  if (!status.isFile()) {
    throw new Error("Extension runtime cache artifact is not a regular file.")
  }
  return status
}

async function assertRegularCacheArtifactOrMissing(path: string): Promise<void> {
  try {
    await assertRegularCacheArtifact(path)
  } catch (error) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      throw error
    }
  }
}

function assertRegularCacheArtifactOrMissingSync(path: string): void {
  try {
    assertRegularCacheArtifactSync(path)
  } catch (error) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      throw error
    }
  }
}

async function quarantineCacheFile(cacheFilePath: string, maxBytes: number): Promise<void> {
  const quarantinePath = `${cacheFilePath}.corrupt`
  await replaceFileWithPrefixAtomically(cacheFilePath, quarantinePath, maxBytes)
}

function quarantineCacheFileSync(cacheFilePath: string, maxBytes: number): void {
  const quarantinePath = `${cacheFilePath}.corrupt`
  replaceFileWithPrefixAtomicallySync(cacheFilePath, quarantinePath, maxBytes)
}

async function boundQuarantineFile(
  cacheDir: string,
  cacheFilePath: string,
  maxBytes: number,
  protectedPaths: ReadonlySet<string>,
  assertLocksOwned: () => void
): Promise<void> {
  const quarantinePath = `${cacheFilePath}.corrupt`
  let quarantineSize: number
  try {
    const status = await lstat(quarantinePath)
    if (!status.isFile()) {
      return
    }
    quarantineSize = status.size
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return
    }
    throw error
  }
  if (quarantineSize <= maxBytes) {
    return
  }
  await reserveCacheArtifactReplacement(
    cacheDir,
    quarantinePath,
    quarantinePath,
    maxBytes,
    protectedPaths
  )
  assertLocksOwned()
  await replaceFileWithPrefixAtomically(quarantinePath, quarantinePath, maxBytes)
}

async function replaceFileWithPrefixAtomically(
  sourcePath: string,
  destinationPath: string,
  maxBytes: number
): Promise<void> {
  const directoryPath = dirname(destinationPath)
  const temporaryPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`
  await assertRegularCacheArtifact(sourcePath)
  await assertRegularCacheArtifactOrMissing(destinationPath)
  const source = await open(sourcePath, "r")
  let sourceOpen = true
  let destination: Awaited<ReturnType<typeof open>> | null = null
  try {
    destination = await open(temporaryPath, "wx", 0o600)
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let remaining = maxBytes
    while (remaining > 0) {
      const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, remaining), null)
      if (bytesRead === 0) {
        break
      }
      await writeRuntimeCacheBufferFully(destination, buffer, bytesRead)
      remaining -= bytesRead
    }
    await destination.sync()
    await destination.close()
    destination = null
    await source.close()
    sourceOpen = false
    await rename(temporaryPath, destinationPath)
    await syncDirectory(directoryPath)
  } finally {
    await destination?.close().catch(() => undefined)
    if (sourceOpen) {
      await source.close()
    }
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function replaceFileWithPrefixAtomicallySync(
  sourcePath: string,
  destinationPath: string,
  maxBytes: number
): void {
  const directoryPath = dirname(destinationPath)
  const temporaryPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`
  assertRegularCacheArtifactSync(sourcePath)
  assertRegularCacheArtifactOrMissingSync(destinationPath)
  const source = openSync(sourcePath, "r")
  let sourceOpen = true
  let destination: number | null = null
  try {
    destination = openSync(temporaryPath, "wx", 0o600)
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let remaining = maxBytes
    while (remaining > 0) {
      const bytesRead = readSync(source, buffer, 0, Math.min(buffer.length, remaining), null)
      if (bytesRead === 0) {
        break
      }
      writeRuntimeCacheBufferFullySync(
        (chunk, offset, length) => writeSync(destination!, chunk, offset, length),
        buffer,
        bytesRead
      )
      remaining -= bytesRead
    }
    fsyncSync(destination)
    closeSync(destination)
    destination = null
    closeSync(source)
    sourceOpen = false
    renameSync(temporaryPath, destinationPath)
    syncDirectorySync(directoryPath)
  } finally {
    if (destination !== null) {
      closeSync(destination)
    }
    if (sourceOpen) {
      closeSync(source)
    }
    try {
      rmSync(temporaryPath, { force: true })
    } catch {
      // The original persistence error remains authoritative.
    }
  }
}

export async function writeRuntimeCacheBufferFully(
  writer: {
    write: (buffer: Uint8Array, offset: number, length: number) => Promise<{ bytesWritten: number }>
  },
  buffer: Uint8Array,
  length: number
): Promise<void> {
  let offset = 0
  while (offset < length) {
    const { bytesWritten } = await writer.write(buffer, offset, length - offset)
    assertValidWriteLength(bytesWritten, length - offset)
    offset += bytesWritten
  }
}

export function writeRuntimeCacheBufferFullySync(
  write: (buffer: Uint8Array, offset: number, length: number) => number,
  buffer: Uint8Array,
  length: number
): void {
  let offset = 0
  while (offset < length) {
    const bytesWritten = write(buffer, offset, length - offset)
    assertValidWriteLength(bytesWritten, length - offset)
    offset += bytesWritten
  }
}

function assertValidWriteLength(bytesWritten: number, requestedBytes: number): void {
  if (!Number.isInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > requestedBytes) {
    throw new Error("Extension runtime cache evidence write did not make valid progress.")
  }
}

async function writeCacheFileAtomically(
  cacheFilePath: string,
  serializedCacheFile: string
): Promise<void> {
  const cacheDirectory = dirname(cacheFilePath)
  const temporaryPath = `${cacheFilePath}.${process.pid}.${randomUUID()}.tmp`
  let temporaryFile: Awaited<ReturnType<typeof open>> | null = null

  try {
    await assertRegularCacheArtifactOrMissing(cacheFilePath)
    temporaryFile = await open(temporaryPath, "wx", 0o600)
    await temporaryFile.writeFile(serializedCacheFile, "utf8")
    await temporaryFile.sync()
    await temporaryFile.close()
    temporaryFile = null
    await rename(temporaryPath, cacheFilePath)
    await syncDirectory(cacheDirectory)
  } finally {
    await temporaryFile?.close().catch(() => undefined)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function writeCacheFileAtomicallySync(cacheFilePath: string, serializedCacheFile: string): void {
  const cacheDirectory = dirname(cacheFilePath)
  const temporaryPath = `${cacheFilePath}.${process.pid}.${randomUUID()}.tmp`
  let temporaryFile: number | null = null

  try {
    assertRegularCacheArtifactOrMissingSync(cacheFilePath)
    temporaryFile = openSync(temporaryPath, "wx", 0o600)
    writeFileSync(temporaryFile, serializedCacheFile, "utf8")
    fsyncSync(temporaryFile)
    closeSync(temporaryFile)
    temporaryFile = null
    renameSync(temporaryPath, cacheFilePath)
    syncDirectorySync(cacheDirectory)
  } finally {
    if (temporaryFile !== null) {
      try {
        closeSync(temporaryFile)
      } catch {
        // The original persistence error remains authoritative.
      }
    }
    try {
      rmSync(temporaryPath, { force: true })
    } catch {
      // Best-effort cleanup cannot replace the original persistence result.
    }
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  if (process.platform === "win32") {
    return
  }

  const directory = await open(directoryPath, "r")
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

function syncDirectorySync(directoryPath: string): void {
  if (process.platform === "win32") {
    return
  }

  const directory = openSync(directoryPath, "r")
  try {
    fsyncSync(directory)
  } finally {
    closeSync(directory)
  }
}

function notifyFailureListener(listener: RuntimeCacheBackendFailureListener, error: Error): void {
  try {
    listener(error)
  } catch {
    // A diagnostic listener cannot change the backend's terminal failure fact.
  }
}

function toCachePersistenceError(cause: unknown): Error {
  if (cause instanceof ExtensionRuntimeCachePersistenceError) {
    return cause
  }
  return new ExtensionRuntimeCachePersistenceError(cause)
}

class ExtensionRuntimeCachePersistenceError extends Error {
  constructor(cause: unknown) {
    super(CACHE_PERSISTENCE_ERROR_MESSAGE, { cause })
    this.name = "ExtensionRuntimeCachePersistenceError"
  }
}

class ExtensionRuntimeCacheCorruptionError extends Error {
  constructor(
    readonly recoveredFile: RuntimeCacheFileShape,
    cause?: unknown
  ) {
    super("Extension runtime cache file is corrupt.", { cause })
    this.name = "ExtensionRuntimeCacheCorruptionError"
  }
}

function reportCacheCorruptionRecovery(): void {
  console.error(CACHE_CORRUPTION_RECOVERY_DIAGNOSTIC)
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}

function readCacheFile(cacheFilePath: string): RuntimeCacheFileShape {
  if (!existsSync(cacheFilePath)) {
    return createEmptyCacheFile()
  }
  assertRegularCacheArtifactSync(cacheFilePath)
  return parseCacheFile(readFileSync(cacheFilePath, "utf8"))
}

function parseCacheFile(raw: string, applyRetention = true): RuntimeCacheFileShape {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) {
      throw cause
    }
    throw new ExtensionRuntimeCacheCorruptionError(createEmptyCacheFile(), cause)
  }

  if (!isRecord(parsed) || !isRecord(parsed.stores)) {
    throw new ExtensionRuntimeCacheCorruptionError(createEmptyCacheFile())
  }

  const isLegacyFile = parsed.version === undefined && parsed.mutationSequence === undefined
  const mutationSequence = isLegacyFile ? 0 : parsed.mutationSequence
  if (
    (!isLegacyFile && parsed.version !== RUNTIME_CACHE_FILE_VERSION) ||
    !Number.isSafeInteger(mutationSequence) ||
    (mutationSequence as number) < 0
  ) {
    throw new ExtensionRuntimeCacheCorruptionError(createEmptyCacheFile())
  }

  const stores = Object.create(null) as Record<string, RuntimeCacheFileStoreShape>
  let containsInvalidStore = false
  for (const [storeKey, rawStore] of Object.entries(parsed.stores)) {
    const entries = isLegacyFile ? rawStore : isRecord(rawStore) ? rawStore.entries : undefined
    const lastMutationSequence = isLegacyFile
      ? 0
      : isRecord(rawStore)
        ? rawStore.lastMutationSequence
        : undefined
    if (
      !Array.isArray(entries) ||
      !Number.isSafeInteger(lastMutationSequence) ||
      (lastMutationSequence as number) < 0 ||
      (lastMutationSequence as number) > (mutationSequence as number) ||
      entries.some(
        (entry) =>
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          typeof entry[0] !== "string" ||
          typeof entry[1] !== "string"
      )
    ) {
      containsInvalidStore = true
      continue
    }
    stores[storeKey] = {
      entries: entries as RuntimeCacheEntry[],
      lastMutationSequence: lastMutationSequence as number
    }
  }

  const parsedFile: RuntimeCacheFileShape = {
    mutationSequence: mutationSequence as number,
    stores,
    version: RUNTIME_CACHE_FILE_VERSION
  }
  const recoveredFile = applyRetention ? retainCacheFile(parsedFile, null) : parsedFile

  if (containsInvalidStore) {
    throw new ExtensionRuntimeCacheCorruptionError(recoveredFile)
  }

  return recoveredFile
}

function createEmptyCacheFile(): RuntimeCacheFileShape {
  return { mutationSequence: 0, stores: {}, version: RUNTIME_CACHE_FILE_VERSION }
}

function retainCacheFile(
  cacheFile: RuntimeCacheFileShape,
  retainedStoreKey: string | null
): RuntimeCacheFileShape {
  const stores = { ...cacheFile.stores }
  const evictionCandidates = Object.entries(stores)
    .filter(([storeKey]) => storeKey !== retainedStoreKey)
    .sort(
      ([leftKey, left], [rightKey, right]) =>
        left.lastMutationSequence - right.lastMutationSequence ||
        compareStoreKeys(leftKey, rightKey)
    )

  let storeCount = Object.keys(stores).length
  while (storeCount > EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE) {
    const candidate = evictionCandidates.shift()
    if (!candidate) {
      throw new RangeError("Extension runtime cache active file exceeded its retention budget.")
    }
    delete stores[candidate[0]]
    storeCount--
  }
  while (
    measureSerializedCacheFile({ ...cacheFile, stores }) >
    EXTENSION_RUNTIME_CACHE_MAX_ACTIVE_FILE_BYTES
  ) {
    const candidate = evictionCandidates.shift()
    if (!candidate) {
      throw new RangeError("Extension runtime cache active file exceeded its retention budget.")
    }
    delete stores[candidate[0]]
  }

  return { ...cacheFile, stores }
}

function compareStoreKeys(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function measureSerializedCacheFile(cacheFile: RuntimeCacheFileShape): number {
  return Buffer.byteLength(serializeCacheFile(cacheFile))
}

function serializeCacheFile(cacheFile: RuntimeCacheFileShape): string {
  return `${JSON.stringify(cacheFile, null, 2)}\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getStoreFilePath(cacheDir: string, scope: RuntimeCacheBackendScope): string {
  const address = JSON.stringify([scope.extensionName, scope.namespace])
  const digest = createHash("sha256").update(address).digest("hex")
  return join(cacheDir, `store-${digest}.json`)
}
