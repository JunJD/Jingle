export const EXTERNAL_EXTENSION_PREFS_KEY_PREFIX = "openwork-ext-prefs:"
export const EXTERNAL_EXTENSION_COMMAND_PREFS_KEY_PREFIX = "openwork-ext-cmd-prefs:"

export function getExternalExtensionPrefsKey(extensionName: string): string {
  return `${EXTERNAL_EXTENSION_PREFS_KEY_PREFIX}${extensionName}`
}

export function getExternalExtensionCommandPrefsKey(
  extensionName: string,
  commandName: string
): string {
  return `${EXTERNAL_EXTENSION_COMMAND_PREFS_KEY_PREFIX}${extensionName}/${commandName}`
}

export function readExternalExtensionPreferenceRecord(key: string): Record<string, unknown> {
  if (!key) {
    return {}
  }

  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function writeExternalExtensionPreferenceRecord(
  key: string,
  value: Record<string, unknown>
): void {
  localStorage.setItem(key, JSON.stringify(value))
}
