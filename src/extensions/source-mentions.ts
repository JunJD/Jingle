import type { ExtensionSourceMention } from "@shared/extension-sources"
import { supportsNativeExtensionPlatformList } from "@shared/native-extensions"
import { nativeExtensionManifests } from "./index"

const nativeExtensionSourceMentionRegistry: ExtensionSourceMention[] =
  nativeExtensionManifests.flatMap((manifest) => {
    const capability = manifest.aiCapability
    if (!capability?.mention) {
      return []
    }
    const supportedPlatforms = capability.supportedPlatforms ?? manifest.supportedPlatforms

    const mention: ExtensionSourceMention = {
      extensionName: manifest.name,
      label: capability.mention.label ?? capability.title,
      sourceId: capability.id,
      supportedPlatforms: supportedPlatforms ? [...supportedPlatforms] : undefined,
      value: capability.mention.value ?? manifest.name
    }
    if (manifest.icon) {
      mention.icon = manifest.icon
    }
    if (manifest.iconName) {
      mention.iconName = manifest.iconName
    }

    return [mention]
  })

export const nativeExtensionSourceMentions = nativeExtensionSourceMentionRegistry.map(
  (mention) => ({
    ...mention,
    supportedPlatforms: mention.supportedPlatforms ? [...mention.supportedPlatforms] : undefined
  })
)

export function listNativeExtensionSourceMentions(platform: string): ExtensionSourceMention[] {
  return nativeExtensionSourceMentionRegistry
    .filter((mention) => supportsNativeExtensionPlatformList(mention.supportedPlatforms, platform))
    .map((mention) => ({
      ...mention,
      supportedPlatforms: mention.supportedPlatforms ? [...mention.supportedPlatforms] : undefined
    }))
}
