import { getActiveExtensionRuntimeSdk, throwExtensionRuntimeRequestError } from "./runtime-context"

export type LocalStorageValue = boolean | number | object | string | null

const DEFAULT_CACHE_CAPACITY_BYTES = 10 * 1024 * 1024
const RUNTIME_CACHE_BACKEND_GLOBAL_KEY = "__JINGLE_EXTENSION_RUNTIME_CACHE_BACKEND__"

export interface RuntimeCacheOptions {
  capacity?: number
  namespace?: string
}

export interface RuntimeCacheBackendScope {
  extensionName: string
  namespace: string
}

export type RuntimeCacheEntry = readonly [key: string, data: string]

export interface RuntimeCacheBackend {
  loadStore: (scope: RuntimeCacheBackendScope) => readonly RuntimeCacheEntry[]
  saveStore: (
    scope: RuntimeCacheBackendScope,
    entries: readonly RuntimeCacheEntry[]
  ) => void
}

export type RuntimeCacheSubscriber = (key: string | undefined, data?: string) => void
export type RuntimeCacheSubscription = () => void

const cacheStores = new Map<string, RuntimeCacheStore>()
let cacheBackendVersion = 0

interface RuntimeCacheStore {
  backend?: RuntimeCacheBackend
  backendVersion: number
  entries: Map<string, string>
  scope?: RuntimeCacheBackendScope
  subscribers: Set<RuntimeCacheSubscriber>
  totalBytes: number
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

  get(key: string): string | undefined {
    const store = this.#getStore()
    const value = store.entries.get(key)
    if (value === undefined) {
      return undefined
    }
    store.entries.delete(key)
    store.entries.set(key, value)
    persistCacheStore(store)
    return value
  }

  has(key: string): boolean {
    return this.#getStore().entries.has(key)
  }

  set(key: string, data: string): void {
    const store = this.#getStore()
    removeCacheEntry(store, key)
    store.entries.set(key, data)
    store.totalBytes += measureCacheEntry(key, data)
    const evictedKeys = trimCacheStore(store, this.#capacity)
    persistCacheStore(store)
    notifyCacheSubscribers(store, key, store.entries.get(key))
    notifyRemovedCacheEntries(
      store,
      evictedKeys.filter((evictedKey) => evictedKey !== key)
    )
  }

  remove(key: string): boolean {
    const store = this.#getStore()
    const removed = removeCacheEntry(store, key)
    if (removed) {
      persistCacheStore(store)
      notifyCacheSubscribers(store, key, undefined)
    }
    return removed
  }

  clear(options: { notifySubscribers?: boolean } = {}): void {
    const store = this.#getStore()
    store.entries.clear()
    store.totalBytes = 0
    persistCacheStore(store)
    if (options.notifySubscribers ?? true) {
      notifyCacheSubscribers(store, undefined, undefined)
    }
  }

  subscribe(subscriber: RuntimeCacheSubscriber): RuntimeCacheSubscription {
    const store = this.#getStore()
    store.subscribers.add(subscriber)
    return () => {
      store.subscribers.delete(subscriber)
    }
  }

  #getStore(): RuntimeCacheStore {
    const store = getCacheStore(this.#namespace)
    if (store.totalBytes > this.#capacity) {
      const evictedKeys = trimCacheStore(store, this.#capacity)
      persistCacheStore(store)
      notifyRemovedCacheEntries(store, evictedKeys)
    }
    return store
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
  }
}

function getCacheStore(namespace: string): RuntimeCacheStore {
  const scope = resolveCacheScope(namespace)
  const storeKey = getCacheStoreKey(scope)
  const existing = cacheStores.get(storeKey)
  const backend = readRuntimeCacheBackend()
  if (existing && existing.backend === backend && existing.backendVersion === cacheBackendVersion) {
    return existing
  }

  const entries = new Map<string, string>()
  let totalBytes = 0
  for (const [key, data] of backend?.loadStore(scope) ?? []) {
    entries.set(key, data)
    totalBytes += measureCacheEntry(key, data)
  }

  const store: RuntimeCacheStore = {
    ...(backend ? { backend, scope } : {}),
    backendVersion: cacheBackendVersion,
    entries,
    subscribers: existing?.subscribers ?? new Set(),
    totalBytes
  }
  cacheStores.set(storeKey, store)
  return store
}

function resolveCacheScope(namespace: string): RuntimeCacheBackendScope {
  return {
    extensionName: readActiveExtensionName(),
    namespace
  }
}

function readActiveExtensionName(): string {
  try {
    return getActiveExtensionRuntimeSdk().extensionName
  } catch {
    return "global"
  }
}

function getCacheStoreKey(scope: RuntimeCacheBackendScope): string {
  return JSON.stringify([scope.extensionName, scope.namespace])
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

function persistCacheStore(store: RuntimeCacheStore): void {
  if (!store.backend || !store.scope) {
    return
  }

  store.backend.saveStore(store.scope, Array.from(store.entries.entries()))
}

function notifyCacheSubscribers(
  store: RuntimeCacheStore,
  key: string | undefined,
  data: string | undefined
): void {
  for (const subscriber of store.subscribers) {
    subscriber(key, data)
  }
}

function notifyRemovedCacheEntries(store: RuntimeCacheStore, keys: readonly string[]): void {
  for (const key of keys) {
    notifyCacheSubscribers(store, key, undefined)
  }
}

function measureCacheEntry(key: string, data: string): number {
  return byteLength(key) + byteLength(data)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
