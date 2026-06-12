import { supportsNativeExtensionPlatform } from "@shared/native-extensions"
import type { ExtensionQuicklinkAlias } from "@shared/extension-quicklinks"
import { DEFAULT_APP_LOCALE, resolveLocalizedText } from "@shared/i18n"
import { imageGenerationManifest } from "../../extensions/image-generation/manifest"
import { todoListManifest } from "./todo-list/manifest"
import { translateManifest } from "./translate/manifest"

export const nativeExtensionManifests = [
  imageGenerationManifest,
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

export function listNativeExtensionQuicklinkAliases(): ExtensionQuicklinkAlias[] {
  return [
    {
      fromExtensionName: "notion-generated",
      nameReplacements: [
        {
          from: "generated Notion",
          to: "Notion"
        },
        {
          from: "Notion Generated",
          to: "Notion"
        }
      ],
      toExtensionName: "notion"
    }
  ]
}
