import type { AppCopy } from "@/lib/i18n/messages"
import type { AppLocale } from "../../../../shared/i18n"
import { AI_CHAT_ENTRY_ID, AI_LAUNCHER_PLUGIN_ID } from "../../../../plugins/ai/manifest"
import { builtLauncherPlugins } from "../built-plugins"
import type {
  LauncherPluginCommandMatch,
  LauncherPluginCommandParams,
  LauncherPluginDefinition,
  LauncherPluginEntryAddress,
  LauncherPluginEntryDefinition,
  LauncherPluginEntryId,
  LauncherPluginId,
  LauncherResolvedPluginIntent
} from "./types"

const launcherPlugins: LauncherPluginDefinition[] = builtLauncherPlugins

const launcherPluginMap = new Map(
  launcherPlugins.map((plugin) => [plugin.manifest.id, plugin] as const)
)

const launcherPluginEntryMap = new Map(
  launcherPlugins.flatMap((plugin) =>
    plugin.entries.map((entry) => [
      `${plugin.manifest.id}:${entry.entryId}`,
      { entry, plugin } as const
    ])
  )
)

export const DEFAULT_HOME_ENTRY: LauncherPluginEntryAddress = {
  entryId: AI_CHAT_ENTRY_ID,
  pluginId: AI_LAUNCHER_PLUGIN_ID
}

function getLauncherPluginEntryKey(address: LauncherPluginEntryAddress): string {
  return `${address.pluginId}:${address.entryId}`
}

export function getLauncherPluginDefinition(pluginId: LauncherPluginId): LauncherPluginDefinition {
  const plugin = launcherPluginMap.get(pluginId)
  if (!plugin) {
    throw new Error(`Unknown launcher plugin "${pluginId}"`)
  }

  return plugin
}

export function listLauncherPluginManifests() {
  return launcherPlugins.map((plugin) => plugin.manifest)
}

export function getLauncherDefaultEntryAddress(
  pluginId: LauncherPluginId
): LauncherPluginEntryAddress {
  const plugin = getLauncherPluginDefinition(pluginId)
  return {
    entryId: plugin.manifest.defaultEntryId,
    pluginId
  }
}

export function getLauncherPluginEntryDefinition(address: LauncherPluginEntryAddress): {
  entry: LauncherPluginEntryDefinition
  plugin: LauncherPluginDefinition
} {
  const resolved = launcherPluginEntryMap.get(getLauncherPluginEntryKey(address))
  if (!resolved) {
    throw new Error(`Unknown launcher plugin entry "${address.pluginId}:${address.entryId}"`)
  }

  return resolved
}

export function getLauncherPluginIntents(params: {
  copy: AppCopy
  locale: AppLocale
  query: string
}): LauncherResolvedPluginIntent[] {
  return launcherPlugins
    .flatMap((plugin) =>
      plugin.entries.flatMap((entry) =>
        (entry.buildIntentItems?.(params) ?? []).map((item) => ({
          entryId: item.entryId ?? entry.entryId,
          id: item.id,
          kind: item.kind,
          pluginId: plugin.manifest.id,
          openOptions: item.openOptions,
          presentation: item.presentation,
          priority: item.priority,
          subtitle: item.subtitle,
          title: item.title
        }))
      )
    )
    .sort((left, right) => {
      const rightPriority = typeof right.priority === "number" ? right.priority : 0
      const leftPriority = typeof left.priority === "number" ? left.priority : 0
      return rightPriority - leftPriority
    })
}

export function resolveLauncherPluginCommand(params: LauncherPluginCommandParams): {
  entryId: LauncherPluginEntryId
  pluginId: LauncherPluginId
  match: LauncherPluginCommandMatch
} | null {
  for (const plugin of launcherPlugins) {
    for (const entry of plugin.entries) {
      const match = entry.resolveCommand?.(params)
      if (match) {
        return {
          entryId: match.entryId ?? entry.entryId,
          match,
          pluginId: plugin.manifest.id
        }
      }
    }
  }

  return null
}
