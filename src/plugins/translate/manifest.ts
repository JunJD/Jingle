import type { LauncherPluginManifest } from "../../shared/launcher-plugin"

export const TRANSLATE_LAUNCHER_PLUGIN_ID = "translate" as const
export const TRANSLATE_MAIN_ENTRY_ID = "translate" as const
export const TRANSLATE_INTENT_ID = "feature-translate-intent" as const
export const TRANSLATE_RPC_METHOD_TRANSLATE = "translate" as const
export const TRANSLATE_RPC_METHODS = [TRANSLATE_RPC_METHOD_TRANSLATE] as const

export const translateLauncherPluginManifest: LauncherPluginManifest<
  typeof TRANSLATE_LAUNCHER_PLUGIN_ID,
  typeof TRANSLATE_MAIN_ENTRY_ID
> = {
  capabilities: ["navigation", "rpc", "surface"],
  defaultEntryId: TRANSLATE_MAIN_ENTRY_ID,
  displayName: "Translate",
  entries: [{ id: TRANSLATE_MAIN_ENTRY_ID }],
  id: TRANSLATE_LAUNCHER_PLUGIN_ID,
  rpcMethods: [...TRANSLATE_RPC_METHODS],
  runtime: "internal-react"
}
