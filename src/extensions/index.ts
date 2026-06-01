import { supportsNativeExtensionPlatform } from "@shared/native-extensions"
import type { ExtensionQuicklinkAlias } from "@shared/extension-quicklinks"
import { appleRemindersManifest } from "../../extensions/apple-reminders/manifest"
import { githubManifest } from "../../extensions/github/manifest"
import { notionManifest } from "../../extensions/notion/manifest"
import { todoListManifest } from "./todo-list/manifest"
import { translateManifest } from "./translate/manifest"

export const nativeExtensionManifests = [
  appleRemindersManifest,
  githubManifest,
  notionManifest,
  todoListManifest,
  translateManifest
].sort((left, right) => left.title.localeCompare(right.title))

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
