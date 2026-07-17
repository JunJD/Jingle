import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { copyFile, mkdir, open, readFile, rename, rm } from "node:fs/promises"
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

interface RuntimeCacheFileShape {
  stores: Record<string, RuntimeCacheEntry[]>
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
        return result.cacheFile.stores[encodeRuntimeCacheBackendScopeKey(scope)] ?? []
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
    const currentEntries = cacheFile.stores[storeKey] ?? []
    await writeCacheFileAtomically(cacheFilePath, {
      stores: {
        ...cacheFile.stores,
        [storeKey]: applyMutation(currentEntries, mutation)
      }
    })
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
      cacheFile: parseCacheFile(await readFile(cacheFilePath, "utf8")),
      corruption: null
    }
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return { cacheFile: { stores: {} }, corruption: null }
    }
    if (error instanceof ExtensionRuntimeCacheCorruptionError) {
      await quarantineCacheFile(cacheFilePath)
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
      quarantineCacheFileSync(cacheFilePath)
      writeCacheFileAtomicallySync(cacheFilePath, error.recoveredFile)
      assertLockIsOwned(compromisedError)
      result = { cacheFile: error.recoveredFile, corruption: error }
    }
  } finally {
    release()
  }

  return result
}

async function quarantineCacheFile(cacheFilePath: string): Promise<void> {
  const cacheDirectory = dirname(cacheFilePath)
  const quarantinePath = `${cacheFilePath}.corrupt`
  await rm(quarantinePath, { force: true })
  await copyFile(cacheFilePath, quarantinePath)
  const quarantineFile = await open(quarantinePath, "r")
  try {
    await quarantineFile.sync()
  } finally {
    await quarantineFile.close()
  }
  await syncDirectory(cacheDirectory)
}

function quarantineCacheFileSync(cacheFilePath: string): void {
  const cacheDirectory = dirname(cacheFilePath)
  const quarantinePath = `${cacheFilePath}.corrupt`
  rmSync(quarantinePath, { force: true })
  copyFileSync(cacheFilePath, quarantinePath)
  const quarantineFile = openSync(quarantinePath, "r")
  try {
    fsyncSync(quarantineFile)
  } finally {
    closeSync(quarantineFile)
  }
  syncDirectorySync(cacheDirectory)
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
    await temporaryFile.writeFile(`${JSON.stringify(cacheFile, null, 2)}\n`, "utf8")
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
    writeFileSync(temporaryFile, `${JSON.stringify(cacheFile, null, 2)}\n`, "utf8")
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
    return { stores: {} }
  }
  return parseCacheFile(readFileSync(cacheFilePath, "utf8"))
}

function parseCacheFile(raw: string): RuntimeCacheFileShape {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) {
      throw cause
    }
    throw new ExtensionRuntimeCacheCorruptionError({ stores: {} }, cause)
  }

  if (!isRecord(parsed) || !isRecord(parsed.stores)) {
    throw new ExtensionRuntimeCacheCorruptionError({ stores: {} })
  }

  const stores = Object.create(null) as Record<string, RuntimeCacheEntry[]>
  let containsInvalidStore = false
  for (const [storeKey, entries] of Object.entries(parsed.stores)) {
    if (
      !Array.isArray(entries) ||
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
    stores[storeKey] = entries as RuntimeCacheEntry[]
  }

  if (containsInvalidStore) {
    throw new ExtensionRuntimeCacheCorruptionError({ stores })
  }

  return { stores }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getStoreFilePath(cacheDir: string, scope: RuntimeCacheBackendScope): string {
  const address = JSON.stringify([scope.extensionName, scope.namespace])
  const digest = createHash("sha256").update(address).digest("hex")
  return join(cacheDir, `store-${digest}.json`)
}
