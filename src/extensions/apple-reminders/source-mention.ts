import type { ExtensionSourceMention } from "@shared/extension-sources"
import { appleRemindersManifest } from "./manifest"
import { APPLE_REMINDERS_EXTENSION_ID } from "./src/contracts"

export const APPLE_REMINDERS_SOURCE_ID = "appleReminders" as const

export const appleRemindersSourceMention: ExtensionSourceMention = {
  extensionName: APPLE_REMINDERS_EXTENSION_ID,
  icon: appleRemindersManifest.icon,
  label: "Apple Reminders",
  sourceId: APPLE_REMINDERS_SOURCE_ID,
  supportedPlatforms: ["darwin"],
  value: APPLE_REMINDERS_EXTENSION_ID
}
