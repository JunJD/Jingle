import { existsSync, readFileSync } from "node:fs"
import { mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { lock } from "proper-lockfile"
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
const CACHE_PERSISTENCE_ERROR_MESSAGE = "Extension runtime cache persistence failed."
const DEFAULT_LOCK_OPTIONS = {
  retryCount: 400,
  retryTimeoutMs: 100,
  staleMs: CACHE_LOCK_STALE_MS,
  updateMs: CACHE_LOCK_STALE_MS / 3
} as const

export function createFileExtensionRuntimeCacheBackend(
  cacheDir: string,
  options: RuntimeCacheFileBackendOptions = {}
): RuntimeCacheBackend {
  const failureListeners = new Set<RuntimeCacheBackendFailureListener>()
  let failure: Error | null = null
  let writeQueue = Promise.resolve()

  return {
    async flush() {
      await writeQueue
      if (failure) {
        throw failure
      }
    },
    loadStore(scope) {
      const cacheFilePath = getStoreFilePath(cacheDir, scope)
      try {
        return readCacheFile(cacheFilePath).stores[encodeRuntimeCacheBackendScopeKey(scope)] ?? []
      } catch (error) {
        throw toCachePersistenceError(error)
      }
    },
    mutateStore(scope, mutation) {
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
            options.lock ?? DEFAULT_LOCK_OPTIONS
          )
        })
        .catch((error: unknown) => {
          if (!failure) {
            failure = toCachePersistenceError(error)
            for (const listener of failureListeners) {
              notifyFailureListener(listener, failure)
            }
          }
          throw failure
        })
      void writeQueue.catch(() => undefined)
    },
    onFailure(listener) {
      failureListeners.add(listener)
      if (failure) {
        notifyFailureListener(listener, failure)
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
  lockOptions: NonNullable<RuntimeCacheFileBackendOptions["lock"]>
): Promise<void> {
  await mkdir(dirname(cacheFilePath), { recursive: true })
  let compromisedError: Error | null = null
  const release = await lock(cacheFilePath, {
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
    const cacheFile = await readCacheFileAsync(cacheFilePath)
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

async function readCacheFileAsync(cacheFilePath: string): Promise<RuntimeCacheFileShape> {
  try {
    return parseCacheFile(await readFile(cacheFilePath, "utf8"))
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return { stores: {} }
    }
    throw error
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
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed) || !isRecord(parsed.stores)) {
    throw new Error("Extension runtime cache file has an invalid shape.")
  }

  const stores = Object.create(null) as Record<string, RuntimeCacheEntry[]>
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
      throw new Error("Extension runtime cache file contains an invalid store.")
    }
    stores[storeKey] = entries as RuntimeCacheEntry[]
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
