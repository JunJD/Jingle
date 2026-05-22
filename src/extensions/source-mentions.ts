import type { ExtensionSourceMention } from "@shared/extension-sources"
import { appleRemindersSourceMention } from "./apple-reminders/source-mention"

const nativeExtensionSourceMentionRegistry: ExtensionSourceMention[] = [appleRemindersSourceMention]

export const nativeExtensionSourceMentions = nativeExtensionSourceMentionRegistry.map((mention) => ({
  ...mention,
  supportedPlatforms: mention.supportedPlatforms ? [...mention.supportedPlatforms] : undefined
}))

export function listNativeExtensionSourceMentions(platform: string): ExtensionSourceMention[] {
  return nativeExtensionSourceMentionRegistry
    .filter((mention) => !mention.supportedPlatforms || mention.supportedPlatforms.includes(platform))
    .map((mention) => ({
      ...mention,
      supportedPlatforms: mention.supportedPlatforms ? [...mention.supportedPlatforms] : undefined
    }))
}
