import type { LauncherCommandOwnerManifest } from "./launcher-command-owner"

export const AI_LAUNCHER_PLUGIN_ID = "ai" as const
export const AI_CHAT_COMMAND_NAME = "chat" as const
export const AI_INTENT_ID = "feature-ai-intent" as const
export const AI_RESULT_KIND = "ai" as const
export const AI_THREAD_SOURCE = "launcher-ai" as const
export const AI_THREAD_VISIBILITY = "launcher-private" as const
export const AI_THREAD_PLACEHOLDER_TITLES = ["快速提问", "Ask Anything"] as const

export const aiBuiltInCommandManifest: LauncherCommandOwnerManifest<
  typeof AI_LAUNCHER_PLUGIN_ID,
  typeof AI_CHAT_COMMAND_NAME
> = {
  capabilities: ["navigation", "clipboard", "surface", "threads"],
  clipboard: {
    accepts: ["text", "files", "image"]
  },
  commands: [
    {
      iconName: "sparkles",
      mode: "view",
      name: AI_CHAT_COMMAND_NAME,
      title: "AI Chat"
    }
  ],
  defaultCommandName: AI_CHAT_COMMAND_NAME,
  displayName: "AI",
  id: AI_LAUNCHER_PLUGIN_ID
}
