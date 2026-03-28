import type { LauncherPluginManifest } from "../../shared/launcher-plugin"

export const AI_LAUNCHER_PLUGIN_ID = "ai" as const
export const AI_CHAT_ENTRY_ID = "chat" as const
export const AI_INTENT_ID = "feature-ai-intent" as const
export const AI_RESULT_KIND = "ai" as const
export const AI_THREAD_SOURCE = "launcher-ai" as const
export const AI_THREAD_VISIBILITY = "launcher-private" as const

export const aiLauncherPluginManifest: LauncherPluginManifest<
  typeof AI_LAUNCHER_PLUGIN_ID,
  typeof AI_CHAT_ENTRY_ID
> = {
  capabilities: ["navigation", "clipboard", "surface", "threads"],
  clipboard: {
    accepts: ["files", "image"]
  },
  defaultEntryId: AI_CHAT_ENTRY_ID,
  displayName: "AI",
  entries: [{ id: AI_CHAT_ENTRY_ID }],
  id: AI_LAUNCHER_PLUGIN_ID,
  runtime: "internal-react"
}
