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
  rmdirSync,
  rmSync,
  unlinkSync,
  watch,
  writeSync,
  writeFileSync,
  type Stats
} from "node:fs"
import { lstat, mkdir, open, readFile, readdir, rename, rmdir, rm, unlink } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { basename, dirname, join } from "node:path"
import * as properLockfile from "proper-lockfile"
import {
  normalizeExtensionRuntimeCacheWriterLease,
  type ExtensionRuntimeCacheWriterLease
} from "@shared/extension-runtime-protocol"
import {
  encodeRuntimeCacheBackendScopeKey,
  type RuntimeCacheBackend,
  type RuntimeCacheBackendAdmission,
  type RuntimeCacheBackendFailureListener,
  type RuntimeCacheBackendMutation,
  type RuntimeCacheBackendSnapshot,
  type RuntimeCacheBackendSnapshotListener,
  type RuntimeCacheBackendSubscription,
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

export interface RuntimeCacheFileBackendOptions {
  lock?: {
    retryCount: number
    retryTimeoutMs: number
    staleMs: number
    updateMs: number
  }
  watchDirectory?: RuntimeCacheDirectoryWatch
  writerLease?: ExtensionRuntimeCacheWriterLease
}

export interface RuntimeCacheDirectoryWatcher {
  close: () => void
}

export type RuntimeCacheDirectoryWatch = (
  directoryPath: string,
  listeners: {
    onChange: (fileName: string | null) => void
    onError: (error: Error) => void
  }
) => RuntimeCacheDirectoryWatcher

interface RuntimeCacheStoreSubscriptionState {
  listeners: Set<RuntimeCacheStoreSubscriptionRegistration>
  notificationQueue: RuntimeCacheSnapshotNotificationBatch[]
  notifyingListeners: boolean
  revision: number
}

interface RuntimeCacheStoreSubscriptionRegistration {
  active: boolean
  admitted: boolean
  listener: RuntimeCacheBackendSnapshotListener
}

interface RuntimeCacheSnapshotNotificationBatch {
  listeners: readonly RuntimeCacheStoreSubscriptionRegistration[]
  snapshot: RuntimeCacheBackendSnapshot
}

interface RuntimeCacheFileSubscriptionState {
  namespaceDigest: string
  stores: Map<string, RuntimeCacheStoreSubscriptionState>
}

interface RuntimeCacheRetentionAddress {
  namespaceDigest: string
  storeKeyDigest: string
}

interface RuntimeCacheRetentionRecord {
  addresses: RuntimeCacheRetentionAddress[]
  sessionId: string
  token: string
  version: typeof CACHE_RETENTION_RECORD_VERSION
}

export const EXTENSION_RUNTIME_CACHE_DIR_ENV = "JINGLE_EXTENSION_RUNTIME_CACHE_DIR"
export const EXTENSION_RUNTIME_CACHE_WRITER_LEASE_ENV =
  "JINGLE_EXTENSION_RUNTIME_CACHE_WRITER_LEASE"

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
const CACHE_FILE_LOCK_PATTERN = /^store-[a-f0-9]{64}\.json\.lock$/
const CACHE_WRITER_LEASE_FILE_PATTERN = /^writer-lease-[a-f0-9]{64}\.json$/
const CACHE_WRITER_LEASE_TEMPORARY_FILE_PATTERN =
  /^writer-lease-[a-f0-9]{64}\.json\.[0-9]+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/
const CACHE_WRITER_LEASE_FILE_VERSION = 1
const CACHE_WRITER_LEASE_MAX_FILE_BYTES = 512
const CACHE_RETENTION_RECORD_VERSION = 2
const CACHE_RETENTION_RECORD_MAX_ADDRESSES =
  EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES * EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE
const CACHE_RETENTION_RECORD_MAX_FILE_BYTES = 64 * 1024
const CACHE_CONTROL_MAX_WRITER_FINAL_FILES = EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES * 2
const CACHE_CONTROL_MAX_RETENTION_FINAL_FILES = EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES * 2
const CACHE_CONTROL_MAX_FINAL_FILES =
  CACHE_CONTROL_MAX_WRITER_FINAL_FILES + CACHE_CONTROL_MAX_RETENTION_FINAL_FILES
const CACHE_CONTROL_MAX_FINAL_BYTES =
  CACHE_CONTROL_MAX_WRITER_FINAL_FILES * CACHE_WRITER_LEASE_MAX_FILE_BYTES +
  CACHE_CONTROL_MAX_RETENTION_FINAL_FILES * CACHE_RETENTION_RECORD_MAX_FILE_BYTES
// Directory operations are serialized, so at most one atomic-replacement temp may coexist with
// the bounded final set.
const CACHE_CONTROL_MAX_PHYSICAL_FILES = CACHE_CONTROL_MAX_FINAL_FILES + 1
const CACHE_CONTROL_MAX_PHYSICAL_BYTES =
  CACHE_CONTROL_MAX_FINAL_BYTES + CACHE_RETENTION_RECORD_MAX_FILE_BYTES
const CACHE_RETENTION_RECORD_FILE_PATTERN = /^retention-lease-[a-f0-9]{64}\.json$/
const CACHE_RETENTION_RECORD_TEMPORARY_FILE_PATTERN =
  /^retention-lease-[a-f0-9]{64}\.json\.[0-9]+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/
const CACHE_NAMESPACE_DIGEST_PATTERN = /^[a-f0-9]{64}$/
const CACHE_STORE_KEY_DIGEST_PATTERN = /^[a-f0-9]{64}$/
const CACHE_CHANGE_FEED_MAX_FILES = EXTENSION_RUNTIME_CACHE_MAX_DIRECTORY_FILES
const CACHE_CHANGE_FEED_MAX_STORES_PER_FILE = EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE

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

export function resetExtensionRuntimeCacheWriterLeases(cacheDir: string): void {
  mkdirSync(cacheDir, { recursive: true })
  withCacheDirectoryLockSync(cacheDir, () => {
    let changed = false
    for (const name of readdirSync(cacheDir)) {
      if (
        !CACHE_WRITER_LEASE_FILE_PATTERN.test(name) &&
        !CACHE_WRITER_LEASE_TEMPORARY_FILE_PATTERN.test(name) &&
        !CACHE_RETENTION_RECORD_FILE_PATTERN.test(name) &&
        !CACHE_RETENTION_RECORD_TEMPORARY_FILE_PATTERN.test(name)
      ) {
        continue
      }
      changed = removeRecognizedRegularFileSync(join(cacheDir, name)) || changed
    }
    if (changed) {
      syncDirectorySync(cacheDir)
    }
  })
}

export async function activateExtensionRuntimeCacheWriterLease(
  cacheDir: string,
  receivedLease: ExtensionRuntimeCacheWriterLease,
  lockOptions: NonNullable<RuntimeCacheFileBackendOptions["lock"]> = DEFAULT_LOCK_OPTIONS
): Promise<void> {
  const lease = normalizeExtensionRuntimeCacheWriterLease(receivedLease)
  await mkdir(cacheDir, { recursive: true })
  let directoryCompromisedError: Error | null = null
  const releaseDirectory = await acquireCacheLock(cacheDir, lockOptions, (error) => {
    directoryCompromisedError = error
  })
  try {
    assertLockIsOwned(directoryCompromisedError)
    await removeOrphanCacheControlTemporaryFiles(cacheDir)
    const leasePath = getCacheWriterLeasePath(cacheDir, lease)
    const serialized = serializeCacheWriterLease(lease)
    const current = await readRegularCacheArtifactSize(leasePath)
    assertCacheControlRecordReservation(
      await measureCacheControlDirectory(cacheDir),
      "writer",
      current,
      Buffer.byteLength(serialized)
    )
    assertLockIsOwned(directoryCompromisedError)
    await writeCacheFileAtomically(leasePath, serialized)
    assertLockIsOwned(directoryCompromisedError)
  } finally {
    await releaseDirectory()
  }
}

export async function revokeExtensionRuntimeCacheWrites(
  cacheDir: string,
  receivedLease: ExtensionRuntimeCacheWriterLease,
  lockOptions: NonNullable<RuntimeCacheFileBackendOptions["lock"]> = DEFAULT_LOCK_OPTIONS
): Promise<void> {
  const lease = normalizeExtensionRuntimeCacheWriterLease(receivedLease)
  if (!existsSync(cacheDir)) {
    return
  }
  let directoryCompromisedError: Error | null = null
  const releaseDirectory = await acquireCacheLock(cacheDir, lockOptions, (error) => {
    directoryCompromisedError = error
  })
  try {
    assertLockIsOwned(directoryCompromisedError)
    const leasePath = getCacheWriterLeasePath(cacheDir, lease)
    if (!(await isActiveCacheWriterLeaseAsync(leasePath, lease))) {
      return
    }
    await unlink(leasePath)
    await syncDirectory(cacheDir)
    assertLockIsOwned(directoryCompromisedError)
  } finally {
    await releaseDirectory()
  }
}

export async function releaseExtensionRuntimeCacheRetention(
  cacheDir: string,
  receivedLease: ExtensionRuntimeCacheWriterLease
): Promise<void> {
  const lease = normalizeExtensionRuntimeCacheWriterLease(receivedLease)
  if (!existsSync(cacheDir)) {
    return
  }
  let directoryCompromisedError: Error | null = null
  const releaseDirectory = await acquireCacheLock(cacheDir, DEFAULT_LOCK_OPTIONS, (error) => {
    directoryCompromisedError = error
  })
  try {
    assertLockIsOwned(directoryCompromisedError)
    let changed = false
    const writerLeasePath = getCacheWriterLeasePath(cacheDir, lease)
    if (isActiveCacheWriterLease(writerLeasePath, lease)) {
      await unlink(writerLeasePath)
      await syncDirectory(cacheDir)
    }
    const retentionPath = getCacheRetentionRecordPath(cacheDir, lease)
    const retention = await readCacheRetentionRecordAsync(retentionPath)
    if (retention && retention.sessionId === lease.sessionId && retention.token === lease.token) {
      await unlink(retentionPath)
      changed = true
    }
    if (changed) {
      await syncDirectory(cacheDir)
    }
    assertLockIsOwned(directoryCompromisedError)
  } finally {
    await releaseDirectory()
  }
}

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
  const admissionPromises = new Set<Promise<RuntimeCacheBackendAdmission>>()
  const subscribedFiles = new Map<string, RuntimeCacheFileSubscriptionState>()
  const pendingRefreshPaths = new Set<string>()
  let directoryWatcher: RuntimeCacheDirectoryWatcher | null = null
  let directoryWatcherAdmission: Promise<void> | null = null
  let refreshLoop: Promise<void> | null = null

  const closeDirectoryWatcher = (): void => {
    directoryWatcher?.close()
    directoryWatcher = null
    pendingRefreshPaths.clear()
  }

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
      closeDirectoryWatcher()
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

  const waitForStableWrites = async (): Promise<void> => {
    let pendingWrites: Promise<void>
    do {
      pendingWrites = writeQueue
      await pendingWrites
    } while (pendingWrites !== writeQueue)
  }

  const refreshSubscribedFile = async (
    cacheFilePath: string
  ): Promise<ReadonlyMap<string, RuntimeCacheBackendSnapshot>> => {
    const fileState = subscribedFiles.get(cacheFilePath)
    if (!fileState) {
      return new Map()
    }
    const result = await readCacheFileWithRecovery(
      cacheDir,
      cacheFilePath,
      fileState.namespaceDigest,
      options.lock ?? DEFAULT_LOCK_OPTIONS,
      options.writerLease
    )
    if (result.corruption) {
      reportCacheCorruptionRecovery()
    }
    const snapshots = new Map<string, RuntimeCacheBackendSnapshot>()
    for (const [storeKey, storeState] of fileState.stores) {
      const snapshot = freezeRuntimeCacheBackendSnapshot({
        entries: result.cacheFile.stores[storeKey]?.entries ?? [],
        revision: storeState.revision + 1
      })
      applyStoreSubscriptionSnapshot(storeState, snapshot)
      snapshots.set(storeKey, snapshot)
    }
    return snapshots
  }

  const runRefreshLoop = async (): Promise<void> => {
    try {
      while (pendingRefreshPaths.size > 0 && acceptingWrites && !failure) {
        await waitForStableWrites()
        const refreshPaths = Array.from(pendingRefreshPaths)
        pendingRefreshPaths.clear()
        for (const cacheFilePath of refreshPaths) {
          await refreshSubscribedFile(cacheFilePath)
        }
      }
    } catch (error) {
      recordFailure(error)
    } finally {
      refreshLoop = null
      if (pendingRefreshPaths.size > 0 && acceptingWrites && !failure) {
        refreshLoop = runRefreshLoop()
      }
    }
  }

  const scheduleRefresh = (cacheFilePath: string): void => {
    if (!acceptingWrites || failure || !subscribedFiles.has(cacheFilePath)) {
      return
    }
    pendingRefreshPaths.add(cacheFilePath)
    refreshLoop ??= runRefreshLoop()
  }

  const ensureDirectoryWatcher = async (): Promise<void> => {
    if (directoryWatcher) {
      return
    }
    directoryWatcherAdmission ??= (async () => {
      await mkdir(cacheDir, { recursive: true })
      if (!acceptingWrites || failure || directoryWatcher || subscribedFiles.size === 0) {
        return
      }
      directoryWatcher = (options.watchDirectory ?? watchRuntimeCacheDirectory)(cacheDir, {
        onChange: (fileName) => {
          if (fileName === null) {
            for (const cacheFilePath of subscribedFiles.keys()) {
              scheduleRefresh(cacheFilePath)
            }
            return
          }
          for (const cacheFilePath of subscribedFiles.keys()) {
            if (basename(cacheFilePath) === fileName) {
              scheduleRefresh(cacheFilePath)
            }
          }
        },
        onError: (error) => {
          recordFailure(error)
        }
      })
    })().finally(() => {
      directoryWatcherAdmission = null
    })
    await directoryWatcherAdmission
  }

  return {
    async close() {
      acceptingWrites = false
      closeDirectoryWatcher()
      subscribedFiles.clear()
      await Promise.allSettled(Array.from(admissionPromises))
      await directoryWatcherAdmission?.catch(() => undefined)
      await refreshLoop
      await drainWrites()
    },
    flush: drainWrites,
    loadStore(scope) {
      const cacheFilePath = getStoreFilePath(cacheDir, scope)
      try {
        const result = readCacheFileWithRecoverySync(
          cacheDir,
          cacheFilePath,
          getCacheNamespaceDigest(scope),
          options.lock ?? DEFAULT_LOCK_OPTIONS,
          options.writerLease
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
            getCacheNamespaceDigest(scope),
            storeKey,
            mutationSnapshot,
            options.lock ?? DEFAULT_LOCK_OPTIONS,
            options.writerLease,
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
    },
    subscribeStore(scope, listener): RuntimeCacheBackendSubscription {
      if (!acceptingWrites) {
        throw failure ?? recordCloseViolation()
      }
      if (failure) {
        throw failure
      }

      const cacheFilePath = getStoreFilePath(cacheDir, scope)
      const storeKey = encodeRuntimeCacheBackendScopeKey(scope)
      let fileState = subscribedFiles.get(cacheFilePath)
      if (!fileState) {
        if (subscribedFiles.size >= CACHE_CHANGE_FEED_MAX_FILES) {
          throw new RangeError("Extension runtime cache change feed file limit exceeded.")
        }
        fileState = { namespaceDigest: getCacheNamespaceDigest(scope), stores: new Map() }
        subscribedFiles.set(cacheFilePath, fileState)
      }
      let storeState = fileState.stores.get(storeKey)
      if (!storeState) {
        if (fileState.stores.size >= CACHE_CHANGE_FEED_MAX_STORES_PER_FILE) {
          throw new RangeError("Extension runtime cache change feed store limit exceeded.")
        }
        storeState = {
          listeners: new Set(),
          notificationQueue: [],
          notifyingListeners: false,
          revision: -1
        }
        fileState.stores.set(storeKey, storeState)
      }
      const registration: RuntimeCacheStoreSubscriptionRegistration = {
        active: true,
        admitted: false,
        listener
      }
      storeState.listeners.add(registration)

      const unsubscribe = (): void => {
        const currentFileState = subscribedFiles.get(cacheFilePath)
        const currentStoreState = currentFileState?.stores.get(storeKey)
        registration.active = false
        currentStoreState?.listeners.delete(registration)
        removeEmptyStoreSubscription(subscribedFiles, cacheFilePath, storeKey)
        if (subscribedFiles.size === 0) {
          closeDirectoryWatcher()
        }
      }
      const admission: Promise<RuntimeCacheBackendAdmission> = Promise.resolve()
        .then(async (): Promise<RuntimeCacheBackendAdmission> => {
          if (!registration.active || !acceptingWrites || failure) {
            return { kind: "cancelled" }
          }
          await admitCacheRetention(
            cacheDir,
            scope,
            options.lock ?? DEFAULT_LOCK_OPTIONS,
            options.writerLease
          )
          if (!registration.active || !acceptingWrites || failure) {
            return { kind: "cancelled" }
          }
          await ensureDirectoryWatcher()
          if (!registration.active || !acceptingWrites || failure) {
            return { kind: "cancelled" }
          }
          await waitForStableWrites()
          if (!registration.active || !acceptingWrites || failure) {
            return { kind: "cancelled" }
          }
          const snapshots = await refreshSubscribedFile(cacheFilePath)
          if (!registration.active || !acceptingWrites || failure) {
            return { kind: "cancelled" }
          }
          const snapshot = snapshots.get(storeKey)
          if (!snapshot) {
            return { kind: "cancelled" }
          }
          registration.admitted = true
          return { kind: "admitted", snapshot }
        })
        .catch((error: unknown) => {
          unsubscribe()
          throw recordFailure(error)
        })
        .finally(() => {
          admissionPromises.delete(admission)
        })
      admissionPromises.add(admission)
      void admission.catch(() => undefined)
      return { admission, unsubscribe }
    }
  }
}

function watchRuntimeCacheDirectory(
  directoryPath: string,
  listeners: {
    onChange: (fileName: string | null) => void
    onError: (error: Error) => void
  }
): RuntimeCacheDirectoryWatcher {
  const watcher = watch(directoryPath, { persistent: false }, (_eventType, fileName) => {
    listeners.onChange(fileName?.toString() ?? null)
  })
  const handleError = (error: Error): void => {
    listeners.onError(error)
  }
  watcher.on("error", handleError)
  return {
    close: () => {
      watcher.off("error", handleError)
      watcher.close()
    }
  }
}

function applyStoreSubscriptionSnapshot(
  state: RuntimeCacheStoreSubscriptionState,
  snapshot: RuntimeCacheBackendSnapshot
): void {
  if (snapshot.revision <= state.revision) {
    return
  }
  if (!Number.isSafeInteger(snapshot.revision)) {
    throw new RangeError("Extension runtime cache change feed revision is exhausted.")
  }
  state.revision = snapshot.revision
  const frozenSnapshot = freezeRuntimeCacheBackendSnapshot(snapshot)
  state.notificationQueue.push({
    listeners: Array.from(state.listeners),
    snapshot: frozenSnapshot
  })
  if (state.notifyingListeners) {
    return
  }

  state.notifyingListeners = true
  try {
    while (state.notificationQueue.length > 0) {
      const batch = state.notificationQueue.shift()!
      for (const registration of batch.listeners) {
        if (!registration.active || !registration.admitted || !state.listeners.has(registration)) {
          continue
        }
        try {
          registration.listener(batch.snapshot)
        } catch {
          console.error("[jingle:extension-runtime] Cache snapshot listener failed.")
        }
      }
    }
  } finally {
    state.notifyingListeners = false
  }
}

function freezeRuntimeCacheBackendSnapshot(
  snapshot: RuntimeCacheBackendSnapshot
): RuntimeCacheBackendSnapshot {
  return Object.freeze({
    entries: Object.freeze(snapshot.entries.map(([key, data]) => [key, data] as const)),
    revision: snapshot.revision
  })
}

function removeEmptyStoreSubscription(
  subscribedFiles: Map<string, RuntimeCacheFileSubscriptionState>,
  cacheFilePath: string,
  storeKey: string
): void {
  const fileState = subscribedFiles.get(cacheFilePath)
  const storeState = fileState?.stores.get(storeKey)
  if (!fileState || !storeState || storeState.listeners.size > 0) {
    return
  }
  fileState.stores.delete(storeKey)
  if (fileState.stores.size === 0) {
    subscribedFiles.delete(cacheFilePath)
  }
}

async function updateCacheFile(
  cacheDir: string,
  cacheFilePath: string,
  namespaceDigest: string,
  storeKey: string,
  mutation: RuntimeCacheBackendMutation,
  lockOptions: NonNullable<RuntimeCacheFileBackendOptions["lock"]>,
  writerLease: ExtensionRuntimeCacheWriterLease | undefined,
  reportRecovery: () => void
): Promise<void> {
  if (!writerLease) {
    await mkdir(cacheDir, { recursive: true })
  }
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
    assertActiveCacheWriterLease(cacheDir, writerLease)
    await removeStaleCacheFileLocks(cacheDir, lockOptions.staleMs)
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
    const retainedStoreKeyDigests = getRetainedStoreKeyDigests(
      await readRetainedCacheAddresses(cacheDir),
      namespaceDigest
    )
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
      mutation.kind === "clear" ? null : storeKey,
      retainedStoreKeyDigests
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

async function admitCacheRetention(
  cacheDir: string,
  scope: RuntimeCacheBackendScope,
  lockOptions: NonNullable<RuntimeCacheFileBackendOptions["lock"]>,
  writerLease: ExtensionRuntimeCacheWriterLease | undefined
): Promise<void> {
  if (!writerLease) {
    return
  }
  await mkdir(cacheDir, { recursive: true })
  let directoryCompromisedError: Error | null = null
  const releaseDirectory = await acquireCacheLock(cacheDir, lockOptions, (error) => {
    directoryCompromisedError = error
  })
  try {
    assertLockIsOwned(directoryCompromisedError)
    assertActiveCacheWriterLease(cacheDir, writerLease)
    await removeOrphanCacheControlTemporaryFiles(cacheDir)
    const retentionPath = getCacheRetentionRecordPath(cacheDir, writerLease)
    const current = await readCacheRetentionRecordAsync(retentionPath)
    if (
      current &&
      (current.sessionId !== writerLease.sessionId || current.token !== writerLease.token)
    ) {
      throw new ExtensionRuntimeCacheWriterLeaseError()
    }
    const address = getCacheRetentionAddress(scope)
    const addresses = [...(current?.addresses ?? []), address]
      .filter(
        (candidate, index, all) =>
          all.findIndex(
            (entry) => encodeCacheRetentionAddress(entry) === encodeCacheRetentionAddress(candidate)
          ) === index
      )
      .sort(compareCacheRetentionAddresses)
    if (addresses.length > CACHE_RETENTION_RECORD_MAX_ADDRESSES) {
      throw new RangeError("Extension runtime cache retention address limit exceeded.")
    }
    const retainedAddresses = await readRetainedCacheAddresses(cacheDir)
    assertRetainedStoreBudget([...retainedAddresses, ...addresses])
    if (
      current?.addresses.some(
        (candidate) =>
          encodeCacheRetentionAddress(candidate) === encodeCacheRetentionAddress(address)
      )
    ) {
      return
    }
    await convergeCacheDirectoryQuota(
      cacheDir,
      createRetainedCacheArtifactPaths(
        cacheDir,
        new Set(addresses.map((candidate) => candidate.namespaceDigest))
      )
    )
    assertLockIsOwned(directoryCompromisedError)
    const next: RuntimeCacheRetentionRecord = {
      addresses,
      sessionId: writerLease.sessionId,
      token: writerLease.token,
      version: CACHE_RETENTION_RECORD_VERSION
    }
    const serialized = serializeCacheRetentionRecord(next)
    const retentionBudget = await measureCacheControlDirectory(cacheDir)
    const currentSize = current ? (await assertRegularCacheArtifact(retentionPath)).size : 0
    const serializedBytes = Buffer.byteLength(serialized)
    assertCacheControlRecordReservation(
      retentionBudget,
      "retention",
      { bytes: currentSize, exists: current !== null },
      serializedBytes
    )
    await writeCacheFileAtomically(retentionPath, serialized)
    assertLockIsOwned(directoryCompromisedError)
  } finally {
    await releaseDirectory()
  }
}

async function readCacheFileWithRecovery(
  cacheDir: string,
  cacheFilePath: string,
  namespaceDigest: string,
  lockOptions: NonNullable<RuntimeCacheFileBackendOptions["lock"]>,
  writerLease: ExtensionRuntimeCacheWriterLease | undefined
): Promise<{
  cacheFile: RuntimeCacheFileShape
  corruption: ExtensionRuntimeCacheCorruptionError | null
}> {
  await mkdir(cacheDir, { recursive: true })
  let directoryCompromisedError: Error | null = null
  let fileCompromisedError: Error | null = null
  const releaseDirectory = await acquireCacheLock(cacheDir, lockOptions, (error) => {
    directoryCompromisedError = error
  })
  let releaseFile: (() => Promise<void>) | null = null
  try {
    assertLockIsOwned(directoryCompromisedError)
    releaseFile = await acquireCacheLock(cacheFilePath, lockOptions, (error) => {
      fileCompromisedError = error
    })
    assertLockIsOwned(directoryCompromisedError)
    assertLockIsOwned(fileCompromisedError)
    const result = await readCacheFileForUpdate(cacheFilePath)
    if (!result.corruption) {
      return result
    }

    assertActiveCacheWriterLease(cacheDir, writerLease)
    const protectedPaths = new Set([cacheFilePath, `${cacheFilePath}.corrupt`])
    await convergeCacheDirectoryQuota(cacheDir, protectedPaths)
    const recoveredFile = retainCacheFile(
      result.corruption.recoveredFile,
      null,
      getRetainedStoreKeyDigests(await readRetainedCacheAddresses(cacheDir), namespaceDigest)
    )
    await reserveCacheArtifactReplacement(
      cacheDir,
      cacheFilePath,
      `${cacheFilePath}.corrupt`,
      EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES,
      protectedPaths
    )
    assertLockIsOwned(directoryCompromisedError)
    assertLockIsOwned(fileCompromisedError)
    await quarantineCacheFile(cacheFilePath, EXTENSION_RUNTIME_CACHE_MAX_CORRUPT_FILE_BYTES)
    const serializedCacheFile = serializeCacheFile(recoveredFile)
    await convergeCacheDirectoryQuota(cacheDir, protectedPaths, {
      bytes: Buffer.byteLength(serializedCacheFile),
      files: 1
    })
    await writeCacheFileAtomically(cacheFilePath, serializedCacheFile)
    await convergeCacheDirectoryQuota(cacheDir, protectedPaths)
    assertLockIsOwned(directoryCompromisedError)
    assertLockIsOwned(fileCompromisedError)
    return { cacheFile: recoveredFile, corruption: result.corruption }
  } finally {
    try {
      await releaseFile?.()
    } finally {
      await releaseDirectory()
    }
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
  namespaceDigest: string,
  lockOptions: NonNullable<RuntimeCacheFileBackendOptions["lock"]>,
  writerLease: ExtensionRuntimeCacheWriterLease | undefined
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

  if (!writerLease) {
    mkdirSync(cacheDir, { recursive: true })
  }
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
    assertActiveCacheWriterLease(cacheDir, writerLease)
    removeStaleCacheFileLocksSync(cacheDir, lockOptions.staleMs)
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
      result = { cacheFile: readCacheFile(cacheFilePath, false), corruption: null }
    } catch (error) {
      if (!(error instanceof ExtensionRuntimeCacheCorruptionError)) {
        throw error
      }
      const recoveredFile = retainCacheFile(
        error.recoveredFile,
        null,
        getRetainedStoreKeyDigests(readRetainedCacheAddressesSync(cacheDir), namespaceDigest)
      )
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

function withCacheDirectoryLockSync(cacheDir: string, operation: () => void): void {
  let compromisedError: Error | null = null
  const release = acquireCacheLockSync(cacheDir, DEFAULT_LOCK_OPTIONS, (error) => {
    compromisedError = error
  })
  try {
    assertLockIsOwned(compromisedError)
    operation()
    assertLockIsOwned(compromisedError)
  } finally {
    release()
  }
}

function assertActiveCacheWriterLease(
  cacheDir: string,
  lease: ExtensionRuntimeCacheWriterLease | undefined
): void {
  if (!lease) {
    return
  }
  if (!isActiveCacheWriterLease(getCacheWriterLeasePath(cacheDir, lease), lease)) {
    throw new ExtensionRuntimeCacheWriterLeaseError()
  }
}

function isActiveCacheWriterLease(
  leasePath: string,
  expectedLease: ExtensionRuntimeCacheWriterLease
): boolean {
  try {
    const status = assertRegularCacheArtifactSync(leasePath)
    if (status.size > CACHE_WRITER_LEASE_MAX_FILE_BYTES) {
      return false
    }
    const parsed = JSON.parse(readFileSync(leasePath, "utf8")) as unknown
    if (
      !isRecord(parsed) ||
      Object.keys(parsed).length !== 3 ||
      parsed.version !== CACHE_WRITER_LEASE_FILE_VERSION
    ) {
      return false
    }
    const lease = normalizeExtensionRuntimeCacheWriterLease({
      sessionId: parsed.sessionId,
      token: parsed.token
    })
    return lease.sessionId === expectedLease.sessionId && lease.token === expectedLease.token
  } catch {
    return false
  }
}

async function isActiveCacheWriterLeaseAsync(
  leasePath: string,
  expectedLease: ExtensionRuntimeCacheWriterLease
): Promise<boolean> {
  try {
    const status = await assertRegularCacheArtifact(leasePath)
    if (status.size > CACHE_WRITER_LEASE_MAX_FILE_BYTES) {
      return false
    }
    const parsed = JSON.parse(await readFile(leasePath, "utf8")) as unknown
    if (
      !isRecord(parsed) ||
      Object.keys(parsed).length !== 3 ||
      parsed.version !== CACHE_WRITER_LEASE_FILE_VERSION
    ) {
      return false
    }
    const lease = normalizeExtensionRuntimeCacheWriterLease({
      sessionId: parsed.sessionId,
      token: parsed.token
    })
    return lease.sessionId === expectedLease.sessionId && lease.token === expectedLease.token
  } catch {
    return false
  }
}

function getCacheWriterLeasePath(
  cacheDir: string,
  lease: ExtensionRuntimeCacheWriterLease
): string {
  const digest = createHash("sha256").update(lease.sessionId).digest("hex")
  return join(cacheDir, `writer-lease-${digest}.json`)
}

function getCacheRetentionRecordPath(
  cacheDir: string,
  lease: ExtensionRuntimeCacheWriterLease
): string {
  const address = JSON.stringify([lease.sessionId, lease.token])
  const digest = createHash("sha256").update(address).digest("hex")
  return join(cacheDir, `retention-lease-${digest}.json`)
}

function readCacheRetentionRecord(path: string): RuntimeCacheRetentionRecord | null {
  try {
    const status = assertRegularCacheArtifactSync(path)
    if (status.size > CACHE_RETENTION_RECORD_MAX_FILE_BYTES) {
      throw new RangeError("Extension runtime cache retention record is too large.")
    }
    return parseCacheRetentionRecord(readFileSync(path, "utf8"))
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return null
    }
    throw error
  }
}

async function readCacheRetentionRecordAsync(
  path: string
): Promise<RuntimeCacheRetentionRecord | null> {
  try {
    const status = await assertRegularCacheArtifact(path)
    if (status.size > CACHE_RETENTION_RECORD_MAX_FILE_BYTES) {
      throw new RangeError("Extension runtime cache retention record is too large.")
    }
    return parseCacheRetentionRecord(await readFile(path, "utf8"))
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return null
    }
    throw error
  }
}

function parseCacheRetentionRecord(raw: string): RuntimeCacheRetentionRecord {
  const parsed = JSON.parse(raw) as unknown
  if (
    !isRecord(parsed) ||
    Object.keys(parsed).length !== 4 ||
    parsed.version !== CACHE_RETENTION_RECORD_VERSION ||
    !Array.isArray(parsed.addresses) ||
    parsed.addresses.length > CACHE_RETENTION_RECORD_MAX_ADDRESSES ||
    !parsed.addresses.every(
      (address): address is RuntimeCacheRetentionAddress =>
        isRecord(address) &&
        Object.keys(address).length === 2 &&
        typeof address.namespaceDigest === "string" &&
        CACHE_NAMESPACE_DIGEST_PATTERN.test(address.namespaceDigest) &&
        typeof address.storeKeyDigest === "string" &&
        CACHE_STORE_KEY_DIGEST_PATTERN.test(address.storeKeyDigest)
    )
  ) {
    throw new TypeError("Extension runtime cache retention record is invalid.")
  }
  const lease = normalizeExtensionRuntimeCacheWriterLease({
    sessionId: parsed.sessionId,
    token: parsed.token
  })
  const addresses = parsed.addresses.map((address) => ({ ...address }))
  if (
    new Set(addresses.map(encodeCacheRetentionAddress)).size !== addresses.length ||
    addresses.some(
      (address, index) =>
        index > 0 && compareCacheRetentionAddresses(addresses[index - 1]!, address) >= 0
    )
  ) {
    throw new TypeError("Extension runtime cache retention record is not canonical.")
  }
  return {
    addresses,
    sessionId: lease.sessionId,
    token: lease.token,
    version: CACHE_RETENTION_RECORD_VERSION
  }
}

function serializeCacheRetentionRecord(record: RuntimeCacheRetentionRecord): string {
  const serialized = `${JSON.stringify(record)}\n`
  if (Buffer.byteLength(serialized) > CACHE_RETENTION_RECORD_MAX_FILE_BYTES) {
    throw new RangeError("Extension runtime cache retention record is too large.")
  }
  return serialized
}

async function readRetainedCacheAddresses(
  cacheDir: string
): Promise<RuntimeCacheRetentionAddress[]> {
  await measureCacheControlDirectory(cacheDir)
  const addresses: RuntimeCacheRetentionAddress[] = []
  for (const name of await readdir(cacheDir)) {
    if (!CACHE_RETENTION_RECORD_FILE_PATTERN.test(name)) {
      continue
    }
    const record = await readCacheRetentionRecordAsync(join(cacheDir, name))
    if (record) {
      assertCacheRetentionRecordAddress(cacheDir, name, record)
      addresses.push(...record.addresses)
    }
  }
  return addresses
}

function readRetainedCacheAddressesSync(cacheDir: string): RuntimeCacheRetentionAddress[] {
  measureCacheControlDirectorySync(cacheDir)
  const addresses: RuntimeCacheRetentionAddress[] = []
  for (const name of readdirSync(cacheDir)) {
    if (!CACHE_RETENTION_RECORD_FILE_PATTERN.test(name)) {
      continue
    }
    const record = readCacheRetentionRecord(join(cacheDir, name))
    if (record) {
      assertCacheRetentionRecordAddress(cacheDir, name, record)
      addresses.push(...record.addresses)
    }
  }
  return addresses
}

function getRetainedStoreKeyDigests(
  addresses: readonly RuntimeCacheRetentionAddress[],
  namespaceDigest: string
): Set<string> {
  return new Set(
    addresses
      .filter((address) => address.namespaceDigest === namespaceDigest)
      .map((address) => address.storeKeyDigest)
  )
}

function assertRetainedStoreBudget(addresses: readonly RuntimeCacheRetentionAddress[]): void {
  const storesByNamespace = new Map<string, Set<string>>()
  for (const address of addresses) {
    const stores = storesByNamespace.get(address.namespaceDigest) ?? new Set<string>()
    stores.add(address.storeKeyDigest)
    if (stores.size > EXTENSION_RUNTIME_CACHE_MAX_STORES_PER_FILE) {
      throw new RangeError("Extension runtime cache retained store limit exceeded.")
    }
    storesByNamespace.set(address.namespaceDigest, stores)
  }
}

async function readRetainedCacheArtifactPaths(cacheDir: string): Promise<Set<string>> {
  const addresses = await readRetainedCacheAddresses(cacheDir)
  return createRetainedCacheArtifactPaths(
    cacheDir,
    new Set(addresses.map((address) => address.namespaceDigest))
  )
}

function readRetainedCacheArtifactPathsSync(cacheDir: string): Set<string> {
  const addresses = readRetainedCacheAddressesSync(cacheDir)
  return createRetainedCacheArtifactPaths(
    cacheDir,
    new Set(addresses.map((address) => address.namespaceDigest))
  )
}

interface RuntimeCacheControlDirectoryBudget {
  bytes: number
  files: number
  retentionFinalBytes: number
  retentionFinalFiles: number
  writerFinalBytes: number
  writerFinalFiles: number
}

async function measureCacheControlDirectory(
  cacheDir: string
): Promise<RuntimeCacheControlDirectoryBudget> {
  const budget = createEmptyCacheControlDirectoryBudget()
  for (const name of await readdir(cacheDir)) {
    const artifact = classifyCacheControlArtifact(name)
    if (!artifact) {
      continue
    }
    const status = await assertRegularCacheArtifact(join(cacheDir, name))
    measureCacheControlArtifact(budget, artifact, status.size)
  }
  return budget
}

function measureCacheControlDirectorySync(cacheDir: string): RuntimeCacheControlDirectoryBudget {
  const budget = createEmptyCacheControlDirectoryBudget()
  for (const name of readdirSync(cacheDir)) {
    const artifact = classifyCacheControlArtifact(name)
    if (!artifact) {
      continue
    }
    const status = assertRegularCacheArtifactSync(join(cacheDir, name))
    measureCacheControlArtifact(budget, artifact, status.size)
  }
  return budget
}

function createEmptyCacheControlDirectoryBudget(): RuntimeCacheControlDirectoryBudget {
  return {
    bytes: 0,
    files: 0,
    retentionFinalBytes: 0,
    retentionFinalFiles: 0,
    writerFinalBytes: 0,
    writerFinalFiles: 0
  }
}

function classifyCacheControlArtifact(
  name: string
): { final: boolean; kind: "retention" | "writer" } | null {
  if (CACHE_RETENTION_RECORD_FILE_PATTERN.test(name)) {
    return { final: true, kind: "retention" }
  }
  if (CACHE_RETENTION_RECORD_TEMPORARY_FILE_PATTERN.test(name)) {
    return { final: false, kind: "retention" }
  }
  if (CACHE_WRITER_LEASE_FILE_PATTERN.test(name)) {
    return { final: true, kind: "writer" }
  }
  if (CACHE_WRITER_LEASE_TEMPORARY_FILE_PATTERN.test(name)) {
    return { final: false, kind: "writer" }
  }
  return null
}

function measureCacheControlArtifact(
  budget: RuntimeCacheControlDirectoryBudget,
  artifact: { final: boolean; kind: "retention" | "writer" },
  bytes: number
): void {
  const maxBytes =
    artifact.kind === "retention"
      ? CACHE_RETENTION_RECORD_MAX_FILE_BYTES
      : CACHE_WRITER_LEASE_MAX_FILE_BYTES
  if (bytes > maxBytes) {
    throw new RangeError("Extension runtime cache control record is too large.")
  }
  budget.bytes += bytes
  budget.files++
  if (artifact.final && artifact.kind === "retention") {
    budget.retentionFinalBytes += bytes
    budget.retentionFinalFiles++
  } else if (artifact.final) {
    budget.writerFinalBytes += bytes
    budget.writerFinalFiles++
  }
  assertCacheControlDirectoryBudget(budget)
}

function assertCacheControlRecordReservation(
  budget: RuntimeCacheControlDirectoryBudget,
  kind: "retention" | "writer",
  current: { bytes: number; exists: boolean },
  nextBytes: number
): void {
  const nextBudget = { ...budget }
  nextBudget.files++
  nextBudget.bytes += nextBytes
  if (kind === "retention") {
    nextBudget.retentionFinalFiles += current.exists ? 0 : 1
    nextBudget.retentionFinalBytes += nextBytes - current.bytes
  } else {
    nextBudget.writerFinalFiles += current.exists ? 0 : 1
    nextBudget.writerFinalBytes += nextBytes - current.bytes
  }
  assertCacheControlDirectoryBudget(nextBudget)
}

function assertCacheControlDirectoryBudget(budget: RuntimeCacheControlDirectoryBudget): void {
  const finalFiles = budget.retentionFinalFiles + budget.writerFinalFiles
  const finalBytes = budget.retentionFinalBytes + budget.writerFinalBytes
  if (
    !Number.isSafeInteger(budget.files) ||
    !Number.isSafeInteger(budget.bytes) ||
    !Number.isSafeInteger(budget.retentionFinalFiles) ||
    !Number.isSafeInteger(budget.retentionFinalBytes) ||
    !Number.isSafeInteger(budget.writerFinalFiles) ||
    !Number.isSafeInteger(budget.writerFinalBytes) ||
    !Number.isSafeInteger(finalFiles) ||
    !Number.isSafeInteger(finalBytes) ||
    budget.retentionFinalFiles > CACHE_CONTROL_MAX_RETENTION_FINAL_FILES ||
    budget.writerFinalFiles > CACHE_CONTROL_MAX_WRITER_FINAL_FILES ||
    finalFiles > CACHE_CONTROL_MAX_FINAL_FILES ||
    finalBytes > CACHE_CONTROL_MAX_FINAL_BYTES ||
    budget.bytes > CACHE_CONTROL_MAX_PHYSICAL_BYTES ||
    budget.files > CACHE_CONTROL_MAX_PHYSICAL_FILES ||
    budget.retentionFinalFiles < 0 ||
    budget.retentionFinalBytes < 0 ||
    budget.writerFinalFiles < 0 ||
    budget.writerFinalBytes < 0 ||
    finalFiles < 0 ||
    finalBytes < 0
  ) {
    throw new RangeError("Extension runtime cache control records exceeded their budget.")
  }
}

async function removeOrphanCacheControlTemporaryFiles(cacheDir: string): Promise<void> {
  let changed = false
  for (const name of await readdir(cacheDir)) {
    if (
      CACHE_RETENTION_RECORD_TEMPORARY_FILE_PATTERN.test(name) ||
      CACHE_WRITER_LEASE_TEMPORARY_FILE_PATTERN.test(name)
    ) {
      changed = (await removeRecognizedRegularFile(join(cacheDir, name))) || changed
    }
  }
  if (changed) {
    await syncDirectory(cacheDir)
  }
}

function removeOrphanCacheControlTemporaryFilesSync(cacheDir: string): void {
  let changed = false
  for (const name of readdirSync(cacheDir)) {
    if (
      CACHE_RETENTION_RECORD_TEMPORARY_FILE_PATTERN.test(name) ||
      CACHE_WRITER_LEASE_TEMPORARY_FILE_PATTERN.test(name)
    ) {
      changed = removeRecognizedRegularFileSync(join(cacheDir, name)) || changed
    }
  }
  if (changed) {
    syncDirectorySync(cacheDir)
  }
}

function assertCacheRetentionRecordAddress(
  cacheDir: string,
  name: string,
  record: RuntimeCacheRetentionRecord
): void {
  if (getCacheRetentionRecordPath(cacheDir, record) !== join(cacheDir, name)) {
    throw new TypeError("Extension runtime cache retention record address is invalid.")
  }
}

function createRetainedCacheArtifactPaths(
  cacheDir: string,
  namespaceDigests: Iterable<string>
): Set<string> {
  const paths = new Set<string>()
  for (const digest of namespaceDigests) {
    const activePath = join(cacheDir, `store-${digest}.json`)
    paths.add(activePath)
    paths.add(`${activePath}.corrupt`)
  }
  return paths
}

function getCacheRetentionAddress(scope: RuntimeCacheBackendScope): RuntimeCacheRetentionAddress {
  return {
    namespaceDigest: getCacheNamespaceDigest(scope),
    storeKeyDigest: getCacheStoreKeyDigest(encodeRuntimeCacheBackendScopeKey(scope))
  }
}

function getCacheStoreKeyDigest(storeKey: string): string {
  return createHash("sha256").update(storeKey).digest("hex")
}

function encodeCacheRetentionAddress(address: RuntimeCacheRetentionAddress): string {
  return `${address.namespaceDigest}:${address.storeKeyDigest}`
}

function compareCacheRetentionAddresses(
  left: RuntimeCacheRetentionAddress,
  right: RuntimeCacheRetentionAddress
): number {
  return (
    compareStoreKeys(left.namespaceDigest, right.namespaceDigest) ||
    compareStoreKeys(left.storeKeyDigest, right.storeKeyDigest)
  )
}

function serializeCacheWriterLease(lease: ExtensionRuntimeCacheWriterLease): string {
  const serialized = `${JSON.stringify({
    sessionId: lease.sessionId,
    token: lease.token,
    version: CACHE_WRITER_LEASE_FILE_VERSION
  })}\n`
  if (Buffer.byteLength(serialized) > CACHE_WRITER_LEASE_MAX_FILE_BYTES) {
    throw new ExtensionRuntimeCacheWriterLeaseError()
  }
  return serialized
}

async function readRegularCacheArtifactSize(
  path: string
): Promise<{ bytes: number; exists: boolean }> {
  try {
    return { bytes: (await assertRegularCacheArtifact(path)).size, exists: true }
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return { bytes: 0, exists: false }
    }
    throw error
  }
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
  await removeOrphanCacheControlTemporaryFiles(cacheDir)
  const effectiveProtectedPaths = new Set([
    ...protectedPaths,
    ...(await readRetainedCacheArtifactPaths(cacheDir))
  ])
  let artifacts = await scanCacheDirectoryArtifacts(cacheDir)
  let changed = false
  for (const artifact of artifacts) {
    if (artifact.kind === "temporary" && !effectiveProtectedPaths.has(artifact.path)) {
      changed = (await removeRecognizedRegularFile(artifact.path)) || changed
    }
  }
  artifacts = await scanCacheDirectoryArtifacts(cacheDir)
  assertProtectedCacheBudget(artifacts, effectiveProtectedPaths, reservation)

  const candidates = createCacheArtifactEvictionCandidates(artifacts, effectiveProtectedPaths)
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
  removeOrphanCacheControlTemporaryFilesSync(cacheDir)
  const effectiveProtectedPaths = new Set([
    ...protectedPaths,
    ...readRetainedCacheArtifactPathsSync(cacheDir)
  ])
  let artifacts = scanCacheDirectoryArtifactsSync(cacheDir)
  let changed = false
  for (const artifact of artifacts) {
    if (artifact.kind === "temporary" && !effectiveProtectedPaths.has(artifact.path)) {
      changed = removeRecognizedRegularFileSync(artifact.path) || changed
    }
  }
  artifacts = scanCacheDirectoryArtifactsSync(cacheDir)
  assertProtectedCacheBudget(artifacts, effectiveProtectedPaths, reservation)

  const candidates = createCacheArtifactEvictionCandidates(artifacts, effectiveProtectedPaths)
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

async function removeStaleCacheFileLocks(cacheDir: string, staleMs: number): Promise<void> {
  const staleBefore = Date.now() - staleMs
  let changed = false
  for (const name of await readdir(cacheDir)) {
    if (!CACHE_FILE_LOCK_PATTERN.test(name)) {
      continue
    }
    const path = join(cacheDir, name)
    try {
      const status = await lstat(path)
      if (
        !status.isDirectory() ||
        !Number.isFinite(status.mtimeMs) ||
        status.mtimeMs >= staleBefore
      ) {
        continue
      }
      try {
        await rmdir(path)
        changed = true
      } catch (error) {
        if (
          !isNodeErrorWithCode(error, "ENOENT") &&
          !isNodeErrorWithCode(error, "ENOTEMPTY") &&
          !isNodeErrorWithCode(error, "EEXIST")
        ) {
          throw error
        }
      }
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        throw error
      }
    }
  }
  if (changed) {
    await syncDirectory(cacheDir)
  }
}

function removeStaleCacheFileLocksSync(cacheDir: string, staleMs: number): void {
  const staleBefore = Date.now() - staleMs
  let changed = false
  for (const name of readdirSync(cacheDir)) {
    if (!CACHE_FILE_LOCK_PATTERN.test(name)) {
      continue
    }
    const path = join(cacheDir, name)
    try {
      const status = lstatSync(path)
      if (
        !status.isDirectory() ||
        !Number.isFinite(status.mtimeMs) ||
        status.mtimeMs >= staleBefore
      ) {
        continue
      }
      try {
        rmdirSync(path)
        changed = true
      } catch (error) {
        if (
          !isNodeErrorWithCode(error, "ENOENT") &&
          !isNodeErrorWithCode(error, "ENOTEMPTY") &&
          !isNodeErrorWithCode(error, "EEXIST")
        ) {
          throw error
        }
      }
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        throw error
      }
    }
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

export class ExtensionRuntimeCacheWriterLeaseError extends Error {
  readonly code = "runtime_cache_writer_lease_inactive"

  constructor() {
    super("Extension runtime cache writer lease is inactive.")
    this.name = "ExtensionRuntimeCacheWriterLeaseError"
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

function readCacheFile(cacheFilePath: string, applyRetention = true): RuntimeCacheFileShape {
  if (!existsSync(cacheFilePath)) {
    return createEmptyCacheFile()
  }
  assertRegularCacheArtifactSync(cacheFilePath)
  return parseCacheFile(readFileSync(cacheFilePath, "utf8"), applyRetention)
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
    const normalizedEntries =
      Array.isArray(entries) &&
      entries.every(
        (entry) =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === "string" &&
          typeof entry[1] === "string"
      )
        ? (entries as RuntimeCacheEntry[])
        : null
    if (
      !normalizedEntries ||
      !Number.isSafeInteger(lastMutationSequence) ||
      (lastMutationSequence as number) < 0 ||
      (lastMutationSequence as number) > (mutationSequence as number) ||
      new Set(normalizedEntries.map(([key]) => key)).size !== normalizedEntries.length
    ) {
      containsInvalidStore = true
      continue
    }
    stores[storeKey] = {
      entries: normalizedEntries,
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
  retainedStoreKey: string | null,
  retainedStoreKeyDigests: ReadonlySet<string> = new Set()
): RuntimeCacheFileShape {
  const stores = { ...cacheFile.stores }
  const evictionCandidates = Object.entries(stores)
    .filter(
      ([storeKey]) =>
        storeKey !== retainedStoreKey &&
        !retainedStoreKeyDigests.has(getCacheStoreKeyDigest(storeKey))
    )
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
  return join(cacheDir, `store-${getCacheNamespaceDigest(scope)}.json`)
}

function getCacheNamespaceDigest(scope: RuntimeCacheBackendScope): string {
  const address = JSON.stringify([scope.extensionName, scope.namespace])
  return createHash("sha256").update(address).digest("hex")
}
