import type { LauncherPluginManifest } from "../../shared/launcher-plugin"

export const TRANSLATE_LAUNCHER_PLUGIN_ID = "translate" as const
export const TRANSLATE_MAIN_COMMAND_NAME = "translate" as const
export const TRANSLATE_QUICK_COPY_COMMAND_NAME = "translate-quick-copy" as const
export const TRANSLATE_INTENT_ID = "feature-translate-intent" as const
export const TRANSLATE_QUICK_COPY_INTENT_ID = "feature-translate-quick-copy-intent" as const
export const TRANSLATE_RPC_METHOD_TRANSLATE = "translate" as const
export const TRANSLATE_RPC_METHODS = [TRANSLATE_RPC_METHOD_TRANSLATE] as const

export const translateLauncherPluginManifest: LauncherPluginManifest<
  typeof TRANSLATE_LAUNCHER_PLUGIN_ID,
  typeof TRANSLATE_MAIN_COMMAND_NAME | typeof TRANSLATE_QUICK_COPY_COMMAND_NAME
> = {
  capabilities: ["navigation", "rpc", "surface"],
  commands: [
    {
      mode: "view",
      name: TRANSLATE_MAIN_COMMAND_NAME,
      title: "Translate"
    },
    {
      mode: "no-view",
      name: TRANSLATE_QUICK_COPY_COMMAND_NAME,
      title: "Quick Translate & Copy"
    }
  ],
  defaultCommandName: TRANSLATE_MAIN_COMMAND_NAME,
  displayName: "Translate",
  id: TRANSLATE_LAUNCHER_PLUGIN_ID,
  rpcMethods: [...TRANSLATE_RPC_METHODS],
  runtime: "internal-react"
}
