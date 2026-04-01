import Store from "electron-store"
import { getOpenworkDir } from "./storage"

interface ExternalExtensionSettingsStoreShape {
  customRoots: string[]
}

const settingsStore = new Store<ExternalExtensionSettingsStoreShape>({
  name: "external-extension-settings",
  cwd: getOpenworkDir(),
  defaults: {
    customRoots: []
  }
})

function normalizePathList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  )
}

export function getExternalExtensionCustomRoots(): string[] {
  return normalizePathList(settingsStore.get("customRoots", []))
}

export function setExternalExtensionCustomRoots(nextRoots: string[]): string[] {
  const normalized = normalizePathList(nextRoots)
  settingsStore.set("customRoots", normalized)
  return normalized
}
