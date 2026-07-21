import { getActiveExtensionRuntimeSdk, throwExtensionRuntimeRequestError } from "./runtime-context"
import type {
  ExtensionRuntimeAvailableCacheIdentity,
  ExtensionRuntimeLocalStorageIdentity
} from "../../shared/extension-runtime-protocol"

export type LocalStorageValue = boolean | number | object | string | null

const DEFAULT_CACHE_CAPACITY_BYTES = 10 * 1024 * 1024
const RUNTIME_CACHE_BACKEND_GLOBAL_KEY = "__JINGLE_EXTENSION_RUNTIME_CACHE_BACKEND__"

export interface RuntimeCacheOptions {
  capacity?: number
  namespace?: string
}

export interface RuntimeCacheBackendScope {
  commandName: string
  extensionName: string
  identity: RuntimeCacheBackendIdentity
  namespace: string
}

export type RuntimeCacheBackendIdentity = ExtensionRuntimeAvailableCacheIdentity &
  ExtensionRuntimeLocalStorageIdentity

export type RuntimeCacheEntry = readonly [key: string, data: string]
export type RuntimeCacheBackendFailureListener = (error: Error) => void
export interface RuntimeCacheBackendSnapshot {
  entries: readonly RuntimeCacheEntry[]
  /** Monotonic for one subscribeStore registration; a later registration starts a new feed. */
  revision: number
}
export type RuntimeCacheBackendSnapshotListener = (snapshot: RuntimeCacheBackendSnapshot) => void
export type RuntimeCacheBackendAdmission =
  | { kind: "admitted"; snapshot: RuntimeCacheBackendSnapshot }
  | { kind: "cancelled" }
export interface RuntimeCacheBackendSubscription {
  admission: Promise<RuntimeCacheBackendAdmission>
  unsubscribe: RuntimeCacheSubscription
}
export type RuntimeCacheBackendMutation =
  | { kind: "clear" }
  | {
      kind: "update"
      removeKeys: readonly string[]
      upsertEntries: readonly RuntimeCacheEntry[]
    }

export interface RuntimeCacheBackend {
  close: () => Promise<void>
  flush: () => Promise<void>
  loadStore: (scope: RuntimeCacheBackendScope) => readonly RuntimeCacheEntry[]
  mutateStore: (scope: RuntimeCacheBackendScope, mutation: RuntimeCacheBackendMutation) => void
  onFailure: (listener: RuntimeCacheBackendFailureListener) => RuntimeCacheSubscription
  subscribeStore: (
    scope: RuntimeCacheBackendScope,
    listener: RuntimeCacheBackendSnapshotListener
  ) => RuntimeCacheBackendSubscription
}

export function encodeRuntimeCacheBackendScopeKey(scope: RuntimeCacheBackendScope): string {
  return JSON.stringify([
    scope.extensionName,
    scope.commandName,
    scope.identity.connectionId,
    scope.identity.credentialGeneration,
    scope.identity.connectionConfigGeneration,
    scope.identity.extensionConfigGeneration,
    scope.identity.commandConfigGeneration,
    scope.identity.runtimePackageRevision,
    scope.identity.runtimeArtifactRevision,
    scope.namespace
  ])
}

export type RuntimeCacheSubscriber = (key: string | undefined, data?: string) => void
export type RuntimeCacheSubscription = () => void
export type RuntimeCacheSubscriptionAdmission =
  | {
      generation: number
      kind: "admitted"
      synchronizationRevision: number | null
    }
  | { generation: number; kind: "cancelled" }
export interface RuntimeCacheSubscriberSubscription extends RuntimeCacheSubscription {
  readonly admission: Promise<RuntimeCacheSubscriptionAdmission>
}

const cacheStores = new Map<string, RuntimeCacheStore>()
let cacheBackendVersion = 0
let cacheSynchronizationRevision = 0

interface RuntimeCacheStore {
  backend?: RuntimeCacheBackend
  backendRevision: number
  backendSubscriptionGeneration: number
  backendSubscriptionPending: boolean
  backendSubscription?: RuntimeCacheBackendSubscription
  backendSubscriptionAdmission?: Promise<RuntimeCacheSubscriptionAdmission>
  backendVersion: number
  entries: Map<string, string>
  key: string
  notificationQueue: RuntimeCacheNotificationBatch[]
  notifyingSubscribers: boolean
  reportSubscriberFailure: (error: unknown) => void
  scope: RuntimeCacheBackendScope
  subscribers: Set<RuntimeCacheSubscriberRegistration>
  synchronizationRevision: number | null
  totalBytes: number
}

interface RuntimeCacheNotificationBatch {
  notifications: readonly (readonly [key: string | undefined, data: string | undefined])[]
  subscribers: readonly RuntimeCacheSubscriberRegistration[]
}

interface RuntimeCacheSubscriberRegistration {
  active: boolean
  subscriber: RuntimeCacheSubscriber
}

interface RuntimeCacheBackendGlobal {
  [RUNTIME_CACHE_BACKEND_GLOBAL_KEY]?: RuntimeCacheBackend
}

export class Cache {
  readonly #capacity: number
  readonly #namespace: string

  constructor(options: RuntimeCacheOptions = {}) {
    this.#capacity = options.capacity ?? DEFAULT_CACHE_CAPACITY_BYTES
    this.#namespace = options.namespace ?? "default"
  }

  get isEmpty(): boolean {
    return this.#getStore().entries.size === 0
  }

  get synchronizationRevision(): number | null {
    const { scope } = resolveCacheStoreContext(this.#namespace)
    const store = cacheStores.get(encodeRuntimeCacheBackendScopeKey(scope))
    const backend = readRuntimeCacheBackend()
    if (!store || store.backend !== backend || store.backendVersion !== cacheBackendVersion) {
      return null
    }
    return store.synchronizationRevision
  }

  get(key: string): string | undefined {
    const store = this.#getStore()
    const value = store.entries.get(key)
    if (value === undefined) {
      return undefined
    }
    store.entries.delete(key)
    store.entries.set(key, value)
    return value
  }

  has(key: string): boolean {
    return this.#getStore().entries.has(key)
  }

  set(key: string, data: string): void {
    const store = this.#getStore()
    assertCacheStoreMutationAdmitted(store)
    removeCacheEntry(store, key)
    store.entries.set(key, data)
    store.totalBytes += measureCacheEntry(key, data)
    const evictedKeys = trimCacheStore(store, this.#capacity)
    const storedData = store.entries.get(key)
    persistCacheMutation(store, {
      kind: "update",
      removeKeys: evictedKeys,
      upsertEntries: storedData === undefined ? [] : [[key, storedData]]
    })
    enqueueCacheNotifications(store, [
      [key, store.entries.get(key)],
      ...evictedKeys
        .filter((evictedKey) => evictedKey !== key)
        .map((evictedKey) => [evictedKey, undefined] as const)
    ])
  }

  remove(key: string): boolean {
    const store = this.#getStore()
    assertCacheStoreMutationAdmitted(store)
    const removed = removeCacheEntry(store, key)
    if (removed) {
      persistCacheMutation(store, {
        kind: "update",
        removeKeys: [key],
        upsertEntries: []
      })
      enqueueCacheNotifications(store, [[key, undefined]])
    }
    return removed
  }

  clear(options: { notifySubscribers?: boolean } = {}): void {
    const store = this.#getStore()
    assertCacheStoreMutationAdmitted(store)
    store.entries.clear()
    store.totalBytes = 0
    persistCacheMutation(store, { kind: "clear" })
    if (options.notifySubscribers ?? true) {
      enqueueCacheNotifications(store, [[undefined, undefined]])
    }
  }

  subscribe(subscriber: RuntimeCacheSubscriber): RuntimeCacheSubscriberSubscription {
    const store = this.#getStore(false)
    const registration: RuntimeCacheSubscriberRegistration = { active: true, subscriber }
    store.subscribers.add(registration)
    try {
      ensureBackendSubscription(store)
    } catch (error) {
      registration.active = false
      store.subscribers.delete(registration)
      throw error
    }
    const unsubscribe = () => {
      removeCacheSubscriber(store, registration)
    }
    return Object.defineProperty(unsubscribe, "admission", {
      configurable: false,
      enumerable: true,
      get: () => readCacheSubscriptionAdmission(store)
    }) as RuntimeCacheSubscriberSubscription
  }

  #getStore(loadBackend = true): RuntimeCacheStore {
    return getCacheStore(this.#namespace, loadBackend)
  }
}

export const LocalStorage = {
  async allItems(): Promise<Record<string, LocalStorageValue>> {
    const response = await getActiveExtensionRuntimeSdk().requestHost({
      capability: "storage",
      method: "all-items",
      payload: {
        scope: "extension"
      }
    })

    if (!response.ok) {
      throwExtensionRuntimeRequestError(response.error)
    }

    return response.result as Record<string, LocalStorageValue>
  },

  async clear(): Promise<void> {
    const response = await getActiveExtensionRuntimeSdk().requestHost({
      capability: "storage",
      method: "clear",
      payload: {
        scope: "extension"
      }
    })

    if (!response.ok) {
      throwExtensionRuntimeRequestError(response.error)
    }
  },

  async getItem<TValue = LocalStorageValue>(key: string): Promise<TValue | undefined> {
    const response = await getActiveExtensionRuntimeSdk().requestHost({
      capability: "storage",
      method: "get",
      payload: {
        key,
        scope: "extension"
      }
    })

    if (!response.ok) {
      throwExtensionRuntimeRequestError(response.error)
    }

    return response.result as TValue | undefined
  },

  async removeItem(key: string): Promise<void> {
    const response = await getActiveExtensionRuntimeSdk().requestHost({
      capability: "storage",
      method: "remove",
      payload: {
        key,
        scope: "extension"
      }
    })

    if (!response.ok) {
      throwExtensionRuntimeRequestError(response.error)
    }
  },

  async setItem(key: string, value: LocalStorageValue): Promise<void> {
    const response = await getActiveExtensionRuntimeSdk().requestHost({
      capability: "storage",
      method: "set",
      payload: {
        key,
        scope: "extension",
        value
      }
    })

    if (!response.ok) {
      throwExtensionRuntimeRequestError(response.error)
    }
  }
}

export function installExtensionRuntimeCacheBackend(
  backend: RuntimeCacheBackend
): RuntimeCacheSubscription {
  const runtimeGlobal = globalThis as RuntimeCacheBackendGlobal
  const previousBackend = runtimeGlobal[RUNTIME_CACHE_BACKEND_GLOBAL_KEY]
  runtimeGlobal[RUNTIME_CACHE_BACKEND_GLOBAL_KEY] = backend
  cacheBackendVersion++
  migrateActiveCacheStores(backend)

  return () => {
    if (runtimeGlobal[RUNTIME_CACHE_BACKEND_GLOBAL_KEY] !== backend) {
      return
    }
    if (previousBackend) {
      runtimeGlobal[RUNTIME_CACHE_BACKEND_GLOBAL_KEY] = previousBackend
    } else {
      delete runtimeGlobal[RUNTIME_CACHE_BACKEND_GLOBAL_KEY]
    }
    cacheBackendVersion++
    migrateActiveCacheStores(previousBackend)
  }
}

function migrateActiveCacheStores(backend: RuntimeCacheBackend | undefined): void {
  for (const store of cacheStores.values()) {
    if (store.subscribers.size === 0) {
      continue
    }
    cancelBackendSubscription(store)
    store.backendVersion = cacheBackendVersion
    if (backend) {
      store.backend = backend
    } else {
      delete store.backend
    }
    store.entries.clear()
    store.totalBytes = 0
    enqueueCacheNotifications(store, [[undefined, undefined]])
    if (backend) {
      ensureBackendSubscription(store)
    }
  }
}

function getCacheStore(namespace: string, loadBackend = true): RuntimeCacheStore {
  const { reportSubscriberFailure, scope } = resolveCacheStoreContext(namespace)
  const storeKey = encodeRuntimeCacheBackendScopeKey(scope)
  const existing = cacheStores.get(storeKey)
  const backend = readRuntimeCacheBackend()
  if (existing && existing.backend === backend && existing.backendVersion === cacheBackendVersion) {
    return existing
  }
  if (existing) {
    cancelBackendSubscription(existing)
  }

  const entries = new Map<string, string>()
  let totalBytes = 0
  for (const [key, data] of loadBackend ? (backend?.loadStore(scope) ?? []) : []) {
    entries.set(key, data)
    totalBytes += measureCacheEntry(key, data)
  }

  const store: RuntimeCacheStore = {
    ...(backend ? { backend } : {}),
    backendRevision: -1,
    backendSubscriptionGeneration: 0,
    backendSubscriptionPending: false,
    backendVersion: cacheBackendVersion,
    entries,
    key: storeKey,
    notificationQueue: [],
    notifyingSubscribers: false,
    reportSubscriberFailure,
    scope,
    subscribers: existing?.subscribers ?? new Set(),
    synchronizationRevision: loadBackend && backend ? ++cacheSynchronizationRevision : null,
    totalBytes
  }
  cacheStores.set(storeKey, store)
  if (store.subscribers.size > 0) {
    ensureBackendSubscription(store)
  }
  return store
}

function removeCacheSubscriber(
  subscribedStore: RuntimeCacheStore,
  registration: RuntimeCacheSubscriberRegistration
): void {
  const currentStore = cacheStores.get(subscribedStore.key)
  const owner =
    currentStore?.subscribers === subscribedStore.subscribers ? currentStore : subscribedStore
  registration.active = false
  owner.subscribers.delete(registration)
  if (owner.subscribers.size === 0) {
    cancelBackendSubscription(owner)
  }
}

function cancelBackendSubscription(store: RuntimeCacheStore): void {
  store.backendSubscriptionGeneration++
  const unsubscribe = store.backendSubscription
  store.backendSubscription = undefined
  store.backendSubscriptionAdmission = undefined
  store.backendRevision = -1
  store.synchronizationRevision = null
  unsubscribe?.unsubscribe()
}

function ensureBackendSubscription(store: RuntimeCacheStore): void {
  if (store.backendSubscription || store.backendSubscriptionPending || !store.backend) {
    return
  }
  store.backendSubscriptionPending = true
  const backend = store.backend
  const generation = ++store.backendSubscriptionGeneration
  store.synchronizationRevision = null
  try {
    const subscription = backend.subscribeStore(store.scope, (snapshot) => {
      if (store.backendSubscriptionGeneration !== generation || store.backend !== backend) {
        return
      }
      applyBackendSnapshot(store, snapshot)
    })
    if (store.backendSubscriptionGeneration === generation && store.backend === backend) {
      store.backendSubscription = subscription
      store.backendSubscriptionAdmission = subscription.admission
        .then((admission): RuntimeCacheSubscriptionAdmission => {
          if (
            store.backendSubscriptionGeneration !== generation ||
            store.backend !== backend ||
            admission.kind === "cancelled"
          ) {
            return { generation, kind: "cancelled" }
          }
          applyBackendSnapshot(store, admission.snapshot)
          return {
            generation,
            kind: "admitted",
            synchronizationRevision: store.synchronizationRevision
          }
        })
        .catch((error) => {
          if (store.backendSubscriptionGeneration === generation && store.backend === backend) {
            cancelBackendSubscription(store)
            store.reportSubscriberFailure(error)
          }
          throw error
        })
      void store.backendSubscriptionAdmission.catch(() => undefined)
    } else {
      subscription.unsubscribe()
    }
  } finally {
    store.backendSubscriptionPending = false
  }
  if (!store.backendSubscription && store.subscribers.size > 0 && store.backend) {
    ensureBackendSubscription(store)
  }
}

function readCacheSubscriptionAdmission(
  subscribedStore: RuntimeCacheStore
): Promise<RuntimeCacheSubscriptionAdmission> {
  const currentStore = cacheStores.get(subscribedStore.key)
  const store =
    currentStore?.subscribers === subscribedStore.subscribers ? currentStore : subscribedStore
  ensureBackendSubscription(store)
  if (store.backendSubscriptionAdmission) {
    return store.backendSubscriptionAdmission
  }
  return Promise.resolve({
    generation: store.backendSubscriptionGeneration,
    kind: "admitted",
    synchronizationRevision: store.synchronizationRevision
  })
}

function applyBackendSnapshot(
  store: RuntimeCacheStore,
  snapshot: RuntimeCacheBackendSnapshot
): void {
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
    throw new TypeError("Extension runtime Cache backend snapshot revision is invalid.")
  }
  if (snapshot.revision <= store.backendRevision) {
    return
  }

  const nextEntries = new Map<string, string>()
  let nextTotalBytes = 0
  for (const entry of snapshot.entries) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      typeof entry[1] !== "string" ||
      nextEntries.has(entry[0])
    ) {
      throw new TypeError("Extension runtime Cache backend snapshot entries are invalid.")
    }
    nextEntries.set(entry[0], entry[1])
    nextTotalBytes += measureCacheEntry(entry[0], entry[1])
  }

  const previousEntries = store.entries
  const notifications: Array<readonly [key: string, data: string | undefined]> = []
  for (const [key, previousData] of previousEntries) {
    const nextData = nextEntries.get(key)
    if (nextData !== previousData) {
      notifications.push([key, nextData])
    }
  }
  for (const [key, nextData] of nextEntries) {
    if (!previousEntries.has(key)) {
      notifications.push([key, nextData])
    }
  }

  store.backendRevision = snapshot.revision
  store.entries = nextEntries
  store.synchronizationRevision = ++cacheSynchronizationRevision
  store.totalBytes = nextTotalBytes
  enqueueCacheNotifications(store, notifications)
}

function resolveCacheStoreContext(namespace: string): {
  reportSubscriberFailure: (error: unknown) => void
  scope: RuntimeCacheBackendScope
} {
  const context = getActiveExtensionRuntimeSdk()
  if (context.dataIdentity.kind !== "available") {
    throw new Error("Extension runtime Cache requires an available data identity.")
  }
  if (context.dataIdentity.cache.kind !== "available") {
    throw new Error(`Extension runtime Cache is unavailable: ${context.dataIdentity.cache.reason}.`)
  }

  return {
    reportSubscriberFailure: context.reportFatalError ?? reportUnhandledCacheSubscriberFailure,
    scope: {
      commandName: context.commandName,
      extensionName: context.extensionName,
      identity: {
        ...context.dataIdentity.localStorage,
        ...context.dataIdentity.cache
      },
      namespace
    }
  }
}

function reportUnhandledCacheSubscriberFailure(): void {
  console.error("[jingle:extension-runtime] Cache subscriber failed without a runtime owner.")
}

function readRuntimeCacheBackend(): RuntimeCacheBackend | undefined {
  return (globalThis as RuntimeCacheBackendGlobal)[RUNTIME_CACHE_BACKEND_GLOBAL_KEY]
}

function removeCacheEntry(store: RuntimeCacheStore, key: string): boolean {
  const existing = store.entries.get(key)
  if (existing === undefined) {
    return false
  }

  store.entries.delete(key)
  store.totalBytes -= measureCacheEntry(key, existing)
  return true
}

function trimCacheStore(store: RuntimeCacheStore, capacity: number): string[] {
  const evictedKeys: string[] = []
  while (store.totalBytes > capacity) {
    const oldestKey = store.entries.keys().next().value
    if (oldestKey === undefined) {
      return evictedKeys
    }
    removeCacheEntry(store, oldestKey)
    evictedKeys.push(oldestKey)
  }
  return evictedKeys
}

function persistCacheMutation(
  store: RuntimeCacheStore,
  mutation: RuntimeCacheBackendMutation
): void {
  if (!store.backend) {
    return
  }

  store.backend.mutateStore(store.scope, mutation)
}

function assertCacheStoreMutationAdmitted(store: RuntimeCacheStore): void {
  if (store.backend && store.subscribers.size > 0 && store.synchronizationRevision === null) {
    throw new Error("Extension runtime Cache subscription admission is pending.")
  }
}

function enqueueCacheNotifications(
  store: RuntimeCacheStore,
  notifications: readonly (readonly [key: string | undefined, data: string | undefined])[]
): void {
  if (notifications.length === 0 || store.subscribers.size === 0) {
    return
  }
  store.notificationQueue.push({
    notifications,
    subscribers: Array.from(store.subscribers)
  })
  if (store.notifyingSubscribers) {
    return
  }

  store.notifyingSubscribers = true
  try {
    while (store.notificationQueue.length > 0) {
      const batch = store.notificationQueue.shift()!
      for (const [key, data] of batch.notifications) {
        if (!cacheNotificationMatchesCurrentStore(store, key, data)) {
          continue
        }
        for (const registration of batch.subscribers) {
          if (!registration.active || !store.subscribers.has(registration)) {
            continue
          }
          if (!cacheNotificationMatchesCurrentStore(store, key, data)) {
            break
          }
          try {
            registration.subscriber(key, data)
          } catch (error) {
            try {
              store.reportSubscriberFailure(error)
            } catch {
              // A failing diagnostic projection must not prevent the remaining subscribers.
            }
          }
        }
      }
    }
  } finally {
    store.notifyingSubscribers = false
  }
}

function cacheNotificationMatchesCurrentStore(
  store: RuntimeCacheStore,
  key: string | undefined,
  data: string | undefined
): boolean {
  return key === undefined ? store.entries.size === 0 : store.entries.get(key) === data
}

function measureCacheEntry(key: string, data: string): number {
  return byteLength(key) + byteLength(data)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
