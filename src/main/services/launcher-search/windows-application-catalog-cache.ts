import Store from "electron-store"
import { getJingleHomeDir } from "../../storage"

export const WINDOWS_APPLICATION_CATALOG_CACHE_SCHEMA_VERSION = 1
export const WINDOWS_APPLICATION_CATALOG_CACHE_MAX_RECORDS = 4_096
export const WINDOWS_APPLICATION_CATALOG_CACHE_MAX_APP_USER_MODEL_ID_LENGTH = 512
export const WINDOWS_APPLICATION_CATALOG_CACHE_MAX_DISPLAY_NAME_LENGTH = 512
export const WINDOWS_APPLICATION_CATALOG_CACHE_MAX_ICON_PATH_LENGTH = 4_096
export const WINDOWS_APPLICATION_CATALOG_CACHE_MAX_INVENTORY_FINGERPRINT_LENGTH = 1_024

const WINDOWS_APPLICATION_CATALOG_CACHE_NAME = "launcher-windows-application-catalog-cache"
const WINDOWS_APPLICATION_CATALOG_CACHE_KEY = "catalog"
const WINDOWS_APPLICATION_CATALOG_CACHE_PLATFORM = "win32"
const WINDOWS_PACKAGED_APPLICATION_ID_PATTERN = /^[a-z0-9._-]+![a-z0-9._-]+$/i

export interface WindowsApplicationCatalogCacheRecord {
  appUserModelId: string
  displayName: string
  iconPath?: string
}

export interface WindowsApplicationCatalogCacheSnapshot {
  enrichedAt: number
  inventoryFingerprint: string
  records: WindowsApplicationCatalogCacheRecord[]
}

interface WindowsApplicationCatalogCacheEnvelope {
  platform: typeof WINDOWS_APPLICATION_CATALOG_CACHE_PLATFORM
  schemaVersion: typeof WINDOWS_APPLICATION_CATALOG_CACHE_SCHEMA_VERSION
  snapshot: WindowsApplicationCatalogCacheSnapshot
}

interface WindowsApplicationCatalogCacheStoreShape {
  catalog?: unknown
}

export interface WindowsApplicationCatalogCacheStoreAdapter {
  get(key: typeof WINDOWS_APPLICATION_CATALOG_CACHE_KEY): unknown
  set(key: typeof WINDOWS_APPLICATION_CATALOG_CACHE_KEY, value: unknown): void
}

export interface WindowsApplicationCatalogCacheRepositoryOptions {
  platform?: NodeJS.Platform
  store?: WindowsApplicationCatalogCacheStoreAdapter
}

export function normalizeWindowsApplicationInventoryFingerprint(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase()
}

export function decodeWindowsApplicationCatalogCache(
  value: unknown,
  platform: NodeJS.Platform
): WindowsApplicationCatalogCacheSnapshot | null {
  if (platform !== WINDOWS_APPLICATION_CATALOG_CACHE_PLATFORM) {
    return null
  }

  const envelope = readExactObject(value, ["platform", "schemaVersion", "snapshot"])
  if (
    !envelope ||
    envelope["platform"] !== WINDOWS_APPLICATION_CATALOG_CACHE_PLATFORM ||
    envelope["schemaVersion"] !== WINDOWS_APPLICATION_CATALOG_CACHE_SCHEMA_VERSION
  ) {
    return null
  }

  return decodeSnapshot(envelope["snapshot"])
}

export function encodeWindowsApplicationCatalogCache(
  snapshot: WindowsApplicationCatalogCacheSnapshot,
  platform: NodeJS.Platform
): WindowsApplicationCatalogCacheEnvelope {
  if (platform !== WINDOWS_APPLICATION_CATALOG_CACHE_PLATFORM) {
    throw new Error("Windows application catalog cache can only be written on Windows")
  }

  return {
    platform: WINDOWS_APPLICATION_CATALOG_CACHE_PLATFORM,
    schemaVersion: WINDOWS_APPLICATION_CATALOG_CACHE_SCHEMA_VERSION,
    snapshot: encodeSnapshot(snapshot)
  }
}

export class WindowsApplicationCatalogCacheRepository {
  private readonly platform: NodeJS.Platform
  private readonly store: WindowsApplicationCatalogCacheStoreAdapter

  constructor(options: WindowsApplicationCatalogCacheRepositoryOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.store = options.store ?? createStore()
  }

  read(): WindowsApplicationCatalogCacheSnapshot | null {
    return decodeWindowsApplicationCatalogCache(
      this.store.get(WINDOWS_APPLICATION_CATALOG_CACHE_KEY),
      this.platform
    )
  }

  write(snapshot: WindowsApplicationCatalogCacheSnapshot): void {
    this.store.set(
      WINDOWS_APPLICATION_CATALOG_CACHE_KEY,
      encodeWindowsApplicationCatalogCache(snapshot, this.platform)
    )
  }
}

function createStore(): WindowsApplicationCatalogCacheStoreAdapter {
  return new Store<WindowsApplicationCatalogCacheStoreShape>({
    cwd: getJingleHomeDir(),
    name: WINDOWS_APPLICATION_CATALOG_CACHE_NAME
  })
}

function decodeSnapshot(value: unknown): WindowsApplicationCatalogCacheSnapshot | null {
  const snapshot = readExactObject(value, ["enrichedAt", "inventoryFingerprint", "records"])
  if (!snapshot || !isValidEnrichedAt(snapshot["enrichedAt"])) {
    return null
  }

  const inventoryFingerprint = snapshot["inventoryFingerprint"]
  if (
    typeof inventoryFingerprint !== "string" ||
    !isNormalizedInventoryFingerprint(inventoryFingerprint)
  ) {
    return null
  }

  const records = snapshot["records"]
  if (!Array.isArray(records) || records.length > WINDOWS_APPLICATION_CATALOG_CACHE_MAX_RECORDS) {
    return null
  }

  const decodedRecords: WindowsApplicationCatalogCacheRecord[] = []
  for (const record of records) {
    const decodedRecord = decodeRecord(record)
    if (!decodedRecord) {
      return null
    }
    decodedRecords.push(decodedRecord)
  }

  return {
    enrichedAt: snapshot["enrichedAt"],
    inventoryFingerprint,
    records: decodedRecords
  }
}

function encodeSnapshot(
  snapshot: WindowsApplicationCatalogCacheSnapshot
): WindowsApplicationCatalogCacheSnapshot {
  if (!isValidEnrichedAt(snapshot.enrichedAt)) {
    throw new TypeError("Windows application catalog cache enrichedAt must be a safe timestamp")
  }
  if (snapshot.records.length > WINDOWS_APPLICATION_CATALOG_CACHE_MAX_RECORDS) {
    throw new RangeError("Windows application catalog cache contains too many records")
  }

  const inventoryFingerprint = normalizeWindowsApplicationInventoryFingerprint(
    snapshot.inventoryFingerprint
  )
  if (!isNormalizedInventoryFingerprint(inventoryFingerprint)) {
    throw new TypeError("Windows application catalog cache inventory fingerprint is invalid")
  }

  return {
    enrichedAt: snapshot.enrichedAt,
    inventoryFingerprint,
    records: snapshot.records.map(encodeRecord)
  }
}

function decodeRecord(value: unknown): WindowsApplicationCatalogCacheRecord | null {
  const record = readExactObject(value, ["appUserModelId", "displayName"], ["iconPath"])
  if (!record) {
    return null
  }

  const appUserModelId = record["appUserModelId"]
  const displayName = record["displayName"]
  if (!isValidAppUserModelId(appUserModelId) || !isValidDisplayName(displayName)) {
    return null
  }

  if (!("iconPath" in record)) {
    return { appUserModelId, displayName }
  }

  const iconPath = record["iconPath"]
  if (!isValidIconPath(iconPath)) {
    return null
  }

  return { appUserModelId, displayName, iconPath }
}

function encodeRecord(
  record: WindowsApplicationCatalogCacheRecord
): WindowsApplicationCatalogCacheRecord {
  const appUserModelId = record.appUserModelId.trim()
  const displayName = record.displayName.trim()
  if (!isValidAppUserModelId(appUserModelId)) {
    throw new TypeError("Windows application catalog cache appUserModelId is invalid")
  }
  if (!isValidDisplayName(displayName)) {
    throw new TypeError("Windows application catalog cache displayName is invalid")
  }

  if (record.iconPath === undefined) {
    return { appUserModelId, displayName }
  }

  const iconPath = record.iconPath.trim()
  if (!isValidIconPath(iconPath)) {
    throw new TypeError("Windows application catalog cache iconPath is invalid")
  }

  return { appUserModelId, displayName, iconPath }
}

function isValidEnrichedAt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isNormalizedInventoryFingerprint(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= WINDOWS_APPLICATION_CATALOG_CACHE_MAX_INVENTORY_FINGERPRINT_LENGTH &&
    value === normalizeWindowsApplicationInventoryFingerprint(value)
  )
}

function isValidAppUserModelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= WINDOWS_APPLICATION_CATALOG_CACHE_MAX_APP_USER_MODEL_ID_LENGTH &&
    value === value.trim() &&
    WINDOWS_PACKAGED_APPLICATION_ID_PATTERN.test(value)
  )
}

function isValidDisplayName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= WINDOWS_APPLICATION_CATALOG_CACHE_MAX_DISPLAY_NAME_LENGTH &&
    value === value.trim()
  )
}

function isValidIconPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= WINDOWS_APPLICATION_CATALOG_CACHE_MAX_ICON_PATH_LENGTH &&
    value === value.trim() &&
    !value.toLowerCase().startsWith("data:")
  )
}

function readExactObject(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys])
  const keys = Object.keys(record)
  if (
    requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(record, key)) ||
    keys.some((key) => !allowedKeys.has(key))
  ) {
    return null
  }

  return record
}
