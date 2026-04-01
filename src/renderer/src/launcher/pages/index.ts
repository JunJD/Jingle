import type { AppCopy } from "@/lib/i18n/messages"
import type { AppLocale } from "../../../../shared/i18n"
import { AI_CHAT_COMMAND_NAME, AI_LAUNCHER_PLUGIN_ID } from "../../../../plugins/ai/manifest"
import { builtLauncherPlugins } from "../built-plugins"
import type {
  LauncherPluginCommandMatch,
  LauncherPluginCommandParams,
  LauncherPluginCommandAddress,
  LauncherPluginCommandDefinition,
  LauncherPluginCommandName,
  LauncherPluginDefinition,
  LauncherPluginId,
  LauncherResolvedPluginIntent
} from "./types"

const launcherPlugins: LauncherPluginDefinition[] = builtLauncherPlugins

const launcherPluginMap = new Map(
  launcherPlugins.map((plugin) => [plugin.manifest.id, plugin] as const)
)

const launcherPluginCommandMap = new Map(
  launcherPlugins.flatMap((plugin) =>
    plugin.commands.map((command) => [
      `${plugin.manifest.id}:${command.commandName}`,
      { command, plugin } as const
    ])
  )
)

export const DEFAULT_HOME_COMMAND: LauncherPluginCommandAddress = {
  kind: "internal-plugin",
  commandName: AI_CHAT_COMMAND_NAME,
  pluginId: AI_LAUNCHER_PLUGIN_ID
}

function getLauncherPluginCommandKey(address: LauncherPluginCommandAddress): string {
  return `${address.pluginId}:${address.commandName}`
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

export function getLauncherDefaultCommandAddress(
  pluginId: LauncherPluginId
): LauncherPluginCommandAddress {
  const plugin = getLauncherPluginDefinition(pluginId)
  return {
    kind: "internal-plugin",
    commandName: plugin.manifest.defaultCommandName,
    pluginId
  }
}

export function getLauncherPluginCommandDefinition(address: LauncherPluginCommandAddress): {
  command: LauncherPluginCommandDefinition
  plugin: LauncherPluginDefinition
} {
  const resolved = launcherPluginCommandMap.get(getLauncherPluginCommandKey(address))
  if (!resolved) {
    throw new Error(`Unknown launcher plugin command "${address.pluginId}:${address.commandName}"`)
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
      plugin.commands.flatMap((command) =>
        (command.buildIntentItems?.(params) ?? []).map((item) => ({
          commandName: item.commandName ?? command.commandName,
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
  commandName: LauncherPluginCommandName
  pluginId: LauncherPluginId
  match: LauncherPluginCommandMatch
} | null {
  for (const plugin of launcherPlugins) {
    for (const command of plugin.commands) {
      const match = command.resolveCommand?.(params)
      if (match) {
        return {
          commandName: match.commandName ?? command.commandName,
          match,
          pluginId: plugin.manifest.id
        }
      }
    }
  }

  return null
}
