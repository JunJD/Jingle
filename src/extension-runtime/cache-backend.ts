import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
  writeFileSync
} from "node:fs"
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises"
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
const CACHE_CORRUPTION_RECOVERY_DIAGNOSTIC =
  "[jingle:extension-runtime] Extension runtime cache corruption was recovered."
const CACHE_PERSISTENCE_ERROR_MESSAGE = "Extension runtime cache persistence failed."
const DEFAULT_LOCK_OPTIONS = {
  retryCount: 400,
  retryTimeoutMs: 100,
  staleMs: CACHE_LOCK_STALE_MS,
  updateMs: CACHE_LOCK_STALE_MS / 3
} as const

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
  cacheFilePath: string,
  storeKey: string,
  mutation: RuntimeCacheBackendMutation,
  lockOptions: NonNullable<RuntimeCacheFileBackendOptions["lock"]>,
  reportRecovery: () => void
): Promise<void> {
  await mkdir(dirname(cacheFilePath), { recursive: true })
  let compromisedError: Error | null = null
  let recoveredCorruption: ExtensionRuntimeCacheCorruptionError | null = null
  const release = await properLockfile.lock(cacheFilePath, {
    onCompromised: (error) => {
      compromisedError = error
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

  try {
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
    if (result.corruption) {
      await quarantineCacheFile(cacheFilePath, EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES)
    } else {
      await boundQuarantineFile(cacheFilePath, EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES)
    }
    await writeCacheFileAtomically(cacheFilePath, nextCacheFile)
    assertLockIsOwned(compromisedError)
  } finally {
    await release()
  }

  if (recoveredCorruption) {
    reportRecovery()
  }
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

  mkdirSync(dirname(cacheFilePath), { recursive: true })
  let compromisedError: Error | null = null
  const release = lockSync(cacheFilePath, {
    onCompromised: (error) => {
      compromisedError = error
    },
    realpath: false,
    retries: 0,
    stale: lockOptions.staleMs,
    update: lockOptions.updateMs
  })
  let result: {
    cacheFile: RuntimeCacheFileShape
    corruption: ExtensionRuntimeCacheCorruptionError | null
  }

  try {
    assertLockIsOwned(compromisedError)
    try {
      result = { cacheFile: readCacheFile(cacheFilePath), corruption: null }
    } catch (error) {
      if (!(error instanceof ExtensionRuntimeCacheCorruptionError)) {
        throw error
      }
      const recoveredFile = retainCacheFile(error.recoveredFile, null)
      quarantineCacheFileSync(cacheFilePath, EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES)
      writeCacheFileAtomicallySync(cacheFilePath, recoveredFile)
      assertLockIsOwned(compromisedError)
      result = { cacheFile: recoveredFile, corruption: error }
    }
  } finally {
    release()
  }

  return result
}

async function quarantineCacheFile(cacheFilePath: string, maxBytes: number): Promise<void> {
  const quarantinePath = `${cacheFilePath}.corrupt`
  await replaceFileWithPrefixAtomically(cacheFilePath, quarantinePath, maxBytes)
}

function quarantineCacheFileSync(cacheFilePath: string, maxBytes: number): void {
  const quarantinePath = `${cacheFilePath}.corrupt`
  replaceFileWithPrefixAtomicallySync(cacheFilePath, quarantinePath, maxBytes)
}

async function boundQuarantineFile(cacheFilePath: string, maxBytes: number): Promise<void> {
  const quarantinePath = `${cacheFilePath}.corrupt`
  let quarantineSize: number
  try {
    quarantineSize = (await stat(quarantinePath)).size
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return
    }
    throw error
  }
  if (quarantineSize <= maxBytes) {
    return
  }
  await replaceFileWithPrefixAtomically(quarantinePath, quarantinePath, maxBytes)
}

async function replaceFileWithPrefixAtomically(
  sourcePath: string,
  destinationPath: string,
  maxBytes: number
): Promise<void> {
  const directoryPath = dirname(destinationPath)
  const temporaryPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`
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
  cacheFile: RuntimeCacheFileShape
): Promise<void> {
  const cacheDirectory = dirname(cacheFilePath)
  const temporaryPath = `${cacheFilePath}.${process.pid}.${randomUUID()}.tmp`
  let temporaryFile: Awaited<ReturnType<typeof open>> | null = null

  try {
    temporaryFile = await open(temporaryPath, "wx", 0o600)
    await temporaryFile.writeFile(serializeCacheFile(cacheFile), "utf8")
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

function writeCacheFileAtomicallySync(
  cacheFilePath: string,
  cacheFile: RuntimeCacheFileShape
): void {
  const cacheDirectory = dirname(cacheFilePath)
  const temporaryPath = `${cacheFilePath}.${process.pid}.${randomUUID()}.tmp`
  let temporaryFile: number | null = null

  try {
    temporaryFile = openSync(temporaryPath, "wx", 0o600)
    writeFileSync(temporaryFile, serializeCacheFile(cacheFile), "utf8")
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
