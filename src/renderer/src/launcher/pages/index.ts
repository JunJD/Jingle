import type { AppCopy } from "@/lib/i18n/messages"
import type { AppLocale } from "../../../../shared/i18n"
import { builtLauncherPlugins } from "../built-plugins"
import { aiLauncherPlugin } from "./ai"
import type {
  LauncherPluginCommandMatch,
  LauncherPluginCommandParams,
  LauncherHomeEntry,
  LauncherPluginDefinition,
  LauncherPluginId,
  LauncherResolvedPluginIntent,
  LauncherPluginTextContext
} from "./types"

const launcherPlugins: LauncherPluginDefinition[] = [aiLauncherPlugin, ...builtLauncherPlugins]

const launcherPluginMap = new Map(
  launcherPlugins.map((plugin) => [plugin.id, plugin] as const)
)

export const DEFAULT_HOME_ENTRY_PLUGIN_ID: LauncherPluginId = aiLauncherPlugin.id

export function getLauncherPluginDefinition(pluginId: LauncherPluginId): LauncherPluginDefinition {
  const plugin = launcherPluginMap.get(pluginId)
  if (!plugin) {
    throw new Error(`Unknown launcher plugin "${pluginId}"`)
  }

  return plugin
}

export function getLauncherHomeEntries(context: LauncherPluginTextContext): LauncherHomeEntry[] {
  return launcherPlugins.flatMap((plugin) => {
    const entry = plugin.buildHomeEntry?.(context)
    return entry ? [entry] : []
  })
}

export function getLauncherPluginIntents(params: {
  copy: AppCopy
  locale: AppLocale
  query: string
}): LauncherResolvedPluginIntent[] {
  return launcherPlugins
    .flatMap((plugin) =>
      (plugin.buildIntentItems?.(params) ?? []).map((item) => ({
        id: item.id,
        kind: item.kind,
        pluginId: plugin.id,
        openOptions: item.openOptions,
        presentation: item.presentation,
        subtitle: item.subtitle,
        title: item.title,
        priority: item.priority
      }))
    )
    .sort((left, right) => {
      const rightPriority = typeof right.priority === "number" ? right.priority : 0
      const leftPriority = typeof left.priority === "number" ? left.priority : 0
      return rightPriority - leftPriority
    })
}

export function resolveLauncherPluginCommand(
  params: LauncherPluginCommandParams
): { pluginId: LauncherPluginId; match: LauncherPluginCommandMatch } | null {
  for (const plugin of launcherPlugins) {
    const match = plugin.resolveCommand?.(params)
    if (match) {
      return {
        match,
        pluginId: plugin.id
      }
    }
  }

  return null
}
