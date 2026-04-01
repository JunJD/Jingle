import type { LauncherPluginManifest } from "../../shared/launcher-plugin"

export const EXTENSIONS_LAB_PLUGIN_ID = "extensions-lab" as const
export const EXTENSIONS_LAB_COMMAND_NAME = "extensions-lab" as const
export const EXTENSIONS_LAB_INTENT_ID = "feature-extensions-lab-intent" as const

export const extensionsLabLauncherPluginManifest: LauncherPluginManifest<
  typeof EXTENSIONS_LAB_PLUGIN_ID,
  typeof EXTENSIONS_LAB_COMMAND_NAME
> = {
  capabilities: ["navigation"],
  commands: [
    {
      description: "Browse and run external Raycast-style extensions inside Openwork.",
      mode: "view",
      name: EXTENSIONS_LAB_COMMAND_NAME,
      title: "Extensions Lab"
    }
  ],
  defaultCommandName: EXTENSIONS_LAB_COMMAND_NAME,
  displayName: "Extensions Lab",
  id: EXTENSIONS_LAB_PLUGIN_ID,
  runtime: "internal-react"
}
