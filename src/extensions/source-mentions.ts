import type {
  ExtensionAiCapability,
  ExtensionAiCapabilityCatalogToolSummary,
  ExtensionSourceMention
} from "@shared/extension-sources"
import { DEFAULT_APP_LOCALE, resolveLocalizedText, type AppLocale } from "@shared/i18n"
import { supportsNativeExtensionPlatformList } from "@shared/native-extensions"
import type { NativeExtensionPackageManifest } from "@shared/native-extensions"
import { nativeExtensionManifests } from "./index"

function toSourceMentionTool(
  capability: ExtensionAiCapability,
  toolName: string,
  locale: AppLocale
): ExtensionAiCapabilityCatalogToolSummary {
  const display =
    capability.toolDisplays &&
    Object.prototype.hasOwnProperty.call(capability.toolDisplays, toolName)
      ? capability.toolDisplays[toolName]
      : undefined
  if (!display) {
    throw new Error(`Missing tool display metadata for "${toolName}".`)
  }
  const title = resolveLocalizedText(display.title, locale)
  return {
    description: resolveLocalizedText(display.description, locale),
    title,
    toolName
  }
}

function toSourceMention(
  manifest: NativeExtensionPackageManifest,
  locale: AppLocale
): ExtensionSourceMention | null {
  const capability = manifest.aiCapability
  if (!capability?.mention) {
    return null
  }

  const supportedPlatforms = capability.supportedPlatforms ?? manifest.supportedPlatforms
  const mention: ExtensionSourceMention = {
    extensionName: manifest.name,
    label: resolveLocalizedText(capability.mention.label ?? capability.title, locale),
    sourceId: capability.id,
    supportedPlatforms: supportedPlatforms ? [...supportedPlatforms] : undefined,
    tools: capability.toolNames.map((toolName) =>
      toSourceMentionTool(capability, toolName, locale)
    ),
    value: capability.mention.value ?? manifest.name
  }
  if (manifest.icon) {
    mention.icon = manifest.icon
  }
  if (manifest.iconName) {
    mention.iconName = manifest.iconName
  }

  return mention
}

function listAllNativeExtensionSourceMentions(locale: AppLocale): ExtensionSourceMention[] {
  return nativeExtensionManifests.flatMap((manifest) => {
    const mention = toSourceMention(manifest, locale)
    return mention ? [mention] : []
  })
}

export const nativeExtensionSourceMentions = listAllNativeExtensionSourceMentions(
  DEFAULT_APP_LOCALE
)

export function listNativeExtensionSourceMentions(
  platform: string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): ExtensionSourceMention[] {
  return listAllNativeExtensionSourceMentions(locale)
    .filter((mention) => supportsNativeExtensionPlatformList(mention.supportedPlatforms, platform))
    .map((mention) => ({
      ...mention,
      supportedPlatforms: mention.supportedPlatforms ? [...mention.supportedPlatforms] : undefined
    }))
}
