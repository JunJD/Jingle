import type { ExtensionRuntimeStorageScope } from "@shared/extension-runtime-protocol"

export interface RuntimeStorageAddress {
  commandName: string
  extensionName: string
  key: string
  scope: ExtensionRuntimeStorageScope
}

export interface RuntimeStorageScopeAddress {
  commandName: string
  extensionName: string
  scope: ExtensionRuntimeStorageScope
}

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

function getRuntimeStorageKeyParts(address: RuntimeStorageAddress): string[] {
  return address.scope === "extension"
    ? [address.extensionName, address.key]
    : [address.extensionName, address.commandName, address.key]
}
