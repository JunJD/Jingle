import type { AppCopy } from "@/lib/i18n/messages"
import { aiLauncherPlugin } from "./ai"
import type { LauncherHomeEntry, LauncherPluginDefinition, LauncherPluginId } from "./types"

const launcherPlugins: LauncherPluginDefinition[] = [aiLauncherPlugin]

const launcherPluginMap: Record<LauncherPluginId, LauncherPluginDefinition> = {
  [aiLauncherPlugin.id]: aiLauncherPlugin
}

export const DEFAULT_HOME_ENTRY_PLUGIN_ID: LauncherPluginId = aiLauncherPlugin.id

export function getLauncherPluginDefinition(pluginId: LauncherPluginId): LauncherPluginDefinition {
  return launcherPluginMap[pluginId]
}

export function getLauncherHomeEntries(copy: AppCopy): LauncherHomeEntry[] {
  return launcherPlugins.map((plugin) => plugin.buildHomeEntry(copy))
}
