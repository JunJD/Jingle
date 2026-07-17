import type {
  ExtensionRuntimeLocalStorageIdentity,
  ExtensionRuntimeStorageScope
} from "@shared/extension-runtime-protocol"

export interface RuntimeStorageAddress {
  commandName: string
  extensionName: string
  identity: ExtensionRuntimeLocalStorageIdentity
  key: string
  scope: ExtensionRuntimeStorageScope
}

export interface RuntimeStorageScopeAddress {
  commandName: string
  extensionName: string
  identity: ExtensionRuntimeLocalStorageIdentity
  scope: ExtensionRuntimeStorageScope
}

export interface RuntimeStorageMigrationResult {
  changed: boolean
  quarantinedKeys: readonly string[]
  values: Record<string, unknown>
}

const LEGACY_UNOWNED_STORAGE_MARKER = "jingle:legacy-unowned:v1"

export function encodeRuntimeStorageKey(address: RuntimeStorageAddress): string {
  return JSON.stringify(getRuntimeStorageKeyParts(address))
}

export function readRuntimeStorageItemKey(
  storageKey: string,
  address: RuntimeStorageScopeAddress
): string | null {
  try {
    const parts = JSON.parse(storageKey)
    if (!Array.isArray(parts)) {
      return null
    }

    if (
      address.scope === "extension" &&
      parts.length === 4 &&
      parts[0] === address.extensionName &&
      parts[1] === address.identity.connectionId &&
      parts[2] === address.identity.credentialGeneration &&
      typeof parts[3] === "string"
    ) {
      return parts[3]
    }

    if (
      address.scope === "command" &&
      parts.length === 5 &&
      parts[0] === address.extensionName &&
      parts[1] === address.identity.connectionId &&
      parts[2] === address.identity.credentialGeneration &&
      parts[3] === address.commandName &&
      typeof parts[4] === "string"
    ) {
      return parts[4]
    }

    return null
  } catch {
    return null
  }
}

export function migrateLegacyRuntimeStorageValues(
  values: Record<string, unknown>,
  address: RuntimeStorageScopeAddress,
  options: { discardBlockedLegacy?: boolean } = {}
): RuntimeStorageMigrationResult {
  const legacyEntries = Object.entries(values).flatMap(([storageKey, value]) => {
    const key = readLegacyRuntimeStorageItemKey(storageKey, address)
    return key === null ? [] : [{ key, storageKey, value }]
  })
  const quarantinedEntries = Object.keys(values).flatMap((storageKey) => {
    const key = readQuarantinedLegacyRuntimeStorageItemKey(storageKey, address)
    return key === null ? [] : [{ key, storageKey }]
  })
  if (legacyEntries.length === 0 && quarantinedEntries.length === 0) {
    return { changed: false, quarantinedKeys: [], values }
  }

  const nextValues = { ...values }
  for (const entry of quarantinedEntries) {
    if (options.discardBlockedLegacy) {
      delete nextValues[entry.storageKey]
    }
  }
  for (const entry of legacyEntries) {
    delete nextValues[entry.storageKey]
    if (options.discardBlockedLegacy) {
      continue
    }
    const nextKey = encodeQuarantinedLegacyRuntimeStorageKey(address, entry.key)
    if (!Object.hasOwn(nextValues, nextKey)) {
      nextValues[nextKey] = entry.value
    }
  }

  return {
    changed:
      legacyEntries.length > 0 ||
      (options.discardBlockedLegacy === true && quarantinedEntries.length > 0),
    quarantinedKeys: options.discardBlockedLegacy
      ? []
      : Array.from(
          new Set([
            ...quarantinedEntries.map((entry) => entry.key),
            ...legacyEntries.map((entry) => entry.key)
          ])
        ),
    values: nextValues
  }
}

export function discardQuarantinedLegacyRuntimeStorageValue(
  values: Record<string, unknown>,
  address: RuntimeStorageScopeAddress,
  key: string
): Record<string, unknown> {
  const storageKey = encodeQuarantinedLegacyRuntimeStorageKey(address, key)
  if (!Object.hasOwn(values, storageKey)) {
    return values
  }

  const nextValues = { ...values }
  delete nextValues[storageKey]
  return nextValues
}

function encodeQuarantinedLegacyRuntimeStorageKey(
  address: RuntimeStorageScopeAddress,
  key: string
): string {
  return JSON.stringify(
    address.scope === "extension"
      ? [LEGACY_UNOWNED_STORAGE_MARKER, address.extensionName, address.scope, key]
      : [
          LEGACY_UNOWNED_STORAGE_MARKER,
          address.extensionName,
          address.scope,
          address.commandName,
          key
        ]
  )
}

function readQuarantinedLegacyRuntimeStorageItemKey(
  storageKey: string,
  address: RuntimeStorageScopeAddress
): string | null {
  try {
    const parts = JSON.parse(storageKey)
    if (
      address.scope === "extension" &&
      Array.isArray(parts) &&
      parts.length === 4 &&
      parts[0] === LEGACY_UNOWNED_STORAGE_MARKER &&
      parts[1] === address.extensionName &&
      parts[2] === address.scope &&
      typeof parts[3] === "string"
    ) {
      return parts[3]
    }
    if (
      address.scope === "command" &&
      Array.isArray(parts) &&
      parts.length === 5 &&
      parts[0] === LEGACY_UNOWNED_STORAGE_MARKER &&
      parts[1] === address.extensionName &&
      parts[2] === address.scope &&
      parts[3] === address.commandName &&
      typeof parts[4] === "string"
    ) {
      return parts[4]
    }
    return null
  } catch {
    return null
  }
}

function readLegacyRuntimeStorageItemKey(
  storageKey: string,
  address: RuntimeStorageScopeAddress
): string | null {
  try {
    const parts = JSON.parse(storageKey)
    if (!Array.isArray(parts)) {
      return null
    }
    if (
      address.scope === "extension" &&
      parts.length === 2 &&
      parts[0] === address.extensionName &&
      typeof parts[1] === "string"
    ) {
      return parts[1]
    }
    if (
      address.scope === "command" &&
      parts.length === 3 &&
      parts[0] === address.extensionName &&
      parts[1] === address.commandName &&
      typeof parts[2] === "string"
    ) {
      return parts[2]
    }
    return null
  } catch {
    return null
  }
}

function getRuntimeStorageKeyParts(address: RuntimeStorageAddress): Array<number | string> {
  return address.scope === "extension"
    ? [
        address.extensionName,
        address.identity.connectionId,
        address.identity.credentialGeneration,
        address.key
      ]
    : [
        address.extensionName,
        address.identity.connectionId,
        address.identity.credentialGeneration,
        address.commandName,
        address.key
      ]
}
