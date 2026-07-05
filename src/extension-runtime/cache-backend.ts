import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type {
  RuntimeCacheBackend,
  RuntimeCacheBackendScope,
  RuntimeCacheEntry
} from "@jingle/extension-api/host-runtime"

interface RuntimeCacheFileShape {
  stores: Record<string, RuntimeCacheEntry[]>
}

export const EXTENSION_RUNTIME_CACHE_DIR_ENV = "JINGLE_EXTENSION_RUNTIME_CACHE_DIR"

export function createFileExtensionRuntimeCacheBackend(cacheDir: string): RuntimeCacheBackend {
  return {
    loadStore(scope) {
      const cacheFilePath = getStoreFilePath(cacheDir, scope)
      return readCacheFile(cacheFilePath).stores[getStoreKey(scope)] ?? []
    },
    saveStore(scope, entries) {
      const cacheFilePath = getStoreFilePath(cacheDir, scope)
      const cacheFile = readCacheFile(cacheFilePath)
      const nextCacheFile = {
        stores: {
          ...cacheFile.stores,
          [getStoreKey(scope)]: [...entries]
        }
      }
      writeCacheFile(cacheFilePath, nextCacheFile)
    }
  }
}

function readCacheFile(cacheFilePath: string): RuntimeCacheFileShape {
  if (!existsSync(cacheFilePath)) {
    return { stores: {} }
  }

  return JSON.parse(readFileSync(cacheFilePath, "utf8")) as RuntimeCacheFileShape
}

function writeCacheFile(cacheFilePath: string, cacheFile: RuntimeCacheFileShape): void {
  mkdirSync(dirname(cacheFilePath), { recursive: true })
  writeFileSync(cacheFilePath, `${JSON.stringify(cacheFile, null, 2)}\n`)
}

function getStoreKey(scope: RuntimeCacheBackendScope): string {
  return JSON.stringify([scope.extensionName, scope.namespace])
}

function getStoreFilePath(cacheDir: string, scope: RuntimeCacheBackendScope): string {
  return join(
    cacheDir,
    encodeURIComponent(scope.extensionName),
    `${encodeURIComponent(scope.namespace)}.json`
  )
}
