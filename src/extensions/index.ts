import { supportsNativeExtensionPlatform } from "@shared/native-extensions"
import { DEFAULT_APP_LOCALE, resolveLocalizedText } from "@shared/i18n"
import { todoListManifest } from "./todo-list/manifest"
import { translateManifest } from "./translate/manifest"

export const nativeExtensionManifests = [
  todoListManifest,
  translateManifest
].sort((left, right) =>
  resolveLocalizedText(left.title, DEFAULT_APP_LOCALE).localeCompare(
    resolveLocalizedText(right.title, DEFAULT_APP_LOCALE)
  )
)

export function listNativeExtensionManifests(platform: string) {
  return nativeExtensionManifests.filter((manifest) =>
    supportsNativeExtensionPlatform(manifest, platform)
  )
}

export function listUserVisibleNativeExtensionManifests(platform: string) {
  return listNativeExtensionManifests(platform)
}
