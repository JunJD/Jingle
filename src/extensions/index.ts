import { supportsNativeExtensionPlatform } from "@shared/native-extensions"
import { appleRemindersManifest } from "../../extensions/apple-reminders/manifest"
import { githubManifest } from "../../extensions/github/manifest"
import { notionManifest } from "./notion/manifest"
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
