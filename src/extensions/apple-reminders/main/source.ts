import type {
  ExtensionSourceBinding,
  ExtensionSourceDefinition,
  SourceProfile
} from "@shared/extension-sources"
import { APPLE_REMINDERS_EXTENSION_ID } from "../src/contracts"

export const APPLE_REMINDERS_SOURCE_ID = "appleReminders" as const

export const appleRemindersSourceDefinition: ExtensionSourceDefinition = {
  defaultToolNames: ["listReminders"],
  description: "Apple Reminders tasks and lists.",
  extensionName: APPLE_REMINDERS_EXTENSION_ID,
  guide:
    "Use Apple Reminders for the user's personal tasks and reminders. List reminders before changing existing tasks. Creating a reminder writes to Apple Reminders and should use the configured Permission Mode.",
  id: APPLE_REMINDERS_SOURCE_ID,
  title: "Apple Reminders",
  writeToolNames: ["createReminder"]
}

const appleRemindersProfileTools: SourceProfile["enabledTools"] = [
  {
    agentToolName: "ext__appleReminders__listReminders",
    display: {
      description: "List active reminders and reminder lists from Apple Reminders.",
      title: "List Reminders"
    },
    toolName: "listReminders"
  },
  {
    agentToolName: "ext__appleReminders__createReminder",
    display: {
      description: "Create a reminder in Apple Reminders.",
      title: "Create Reminder"
    },
    toolName: "createReminder"
  }
]

export function createDefaultAppleRemindersSourceProfile(
  input: {
    now?: string
    platform?: NodeJS.Platform | string
  } = {}
): SourceProfile {
  const now = input.now ?? new Date().toISOString()
  const isAvailable = (input.platform ?? process.platform) === "darwin"

  return {
    authStatus: isAvailable ? "connected" : "missing",
    createdAt: now,
    defaultPermissionMode: "ask-to-edit",
    displayName: "Apple Reminders",
    enabled: isAvailable,
    enabledTools: structuredClone(appleRemindersProfileTools),
    enabledToolNames: ["listReminders", "createReminder"],
    extensionName: APPLE_REMINDERS_EXTENSION_ID,
    id: "apple-reminders-default",
    publicConfig: {},
    sourceId: APPLE_REMINDERS_SOURCE_ID,
    updatedAt: now
  }
}

export function createDefaultAppleRemindersSourceBinding(
  input: {
    now?: string
    platform?: NodeJS.Platform | string
  } = {}
): ExtensionSourceBinding {
  return {
    profile: createDefaultAppleRemindersSourceProfile(input),
    source: appleRemindersSourceDefinition
  }
}
