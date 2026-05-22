import type { ExtensionSourceMention } from "@shared/extension-sources"
import { APPLE_REMINDERS_EXTENSION_ID } from "./src/contracts"

export const APPLE_REMINDERS_SOURCE_ID = "appleReminders" as const

export const appleRemindersSourceMention: ExtensionSourceMention = {
  extensionName: APPLE_REMINDERS_EXTENSION_ID,
  iconName: "reminders",
  label: "Apple Reminders",
  sourceId: APPLE_REMINDERS_SOURCE_ID,
  supportedPlatforms: ["darwin"],
  value: APPLE_REMINDERS_EXTENSION_ID
}
