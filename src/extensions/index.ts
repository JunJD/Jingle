import { supportsNativeExtensionPlatform } from "../shared/native-extensions"
import { appleRemindersManifest } from "./apple-reminders/manifest"
import { githubManifest } from "./github/manifest"
import { todoListManifest } from "./todo-list/manifest"
import { translateManifest } from "./translate/manifest"

export const nativeExtensionManifests = [
  appleRemindersManifest,
  githubManifest,
  todoListManifest,
  translateManifest
].sort((left, right) => left.title.localeCompare(right.title))

export function listNativeExtensionManifests(platform: string) {
  return nativeExtensionManifests.filter((manifest) =>
    supportsNativeExtensionPlatform(manifest, platform)
  )
}
