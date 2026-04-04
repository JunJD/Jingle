import type { AppCopy } from "@/lib/i18n/messages"
import type { AppLocale } from "@shared/i18n"
import { AI_CHAT_COMMAND_NAME, AI_LAUNCHER_PLUGIN_ID } from "@plugins/ai/manifest"
import { aiLauncherPlugin } from "@launcher/built-plugins/ai"
import { nativeLauncherPlugins } from "@launcher/native-extensions"
import type {
  LauncherBuiltInCommandAddress,
  LauncherBuiltInId,
  LauncherCommandAddress,
  LauncherCommandMatch,
  LauncherCommandName,
  LauncherCommandParams,
  LauncherExtensionName,
  LauncherPluginCommandDefinition,
  LauncherPluginDefinition,
  LauncherResolvedCommandIntent
} from "./types"

const builtInLauncherPlugins: LauncherPluginDefinition[] = [aiLauncherPlugin]
const extensionLauncherPlugins: LauncherPluginDefinition[] = nativeLauncherPlugins

const builtInLauncherPluginMap = new Map(
  builtInLauncherPlugins.map((plugin) => [plugin.manifest.id as LauncherBuiltInId, plugin] as const)
)

const extensionLauncherPluginMap = new Map(
  extensionLauncherPlugins.map(
    (plugin) => [plugin.manifest.id as LauncherExtensionName, plugin] as const
  )
)

const builtInCommandMap = new Map(
  builtInLauncherPlugins.flatMap((plugin) =>
    plugin.commands.map((command) => [
      `${plugin.manifest.id}:${command.commandName}`,
      { command, plugin } as const
    ])
  )
)

const extensionCommandMap = new Map(
  extensionLauncherPlugins.flatMap((plugin) =>
    plugin.commands.map((command) => [
      `${plugin.manifest.id}:${command.commandName}`,
      { command, plugin } as const
    ])
  )
)

export const DEFAULT_HOME_COMMAND: LauncherBuiltInCommandAddress = {
  builtInId: AI_LAUNCHER_PLUGIN_ID,
  commandName: AI_CHAT_COMMAND_NAME,
  kind: "built-in-command"
}

export interface LauncherIndexedCommand {
  address: LauncherCommandAddress
  description: string
  keywords: string[]
  ownerTitle: string
  title: string
}

function createLauncherCommandAddress(params: {
  builtInId: LauncherBuiltInId
  commandName: LauncherCommandName
}): LauncherBuiltInCommandAddress
function createLauncherCommandAddress(params: {
  commandName: LauncherCommandName
  extensionName: LauncherExtensionName
}): LauncherCommandAddress
function createLauncherCommandAddress(params: {
  builtInId?: LauncherBuiltInId
  commandName: LauncherCommandName
  extensionName?: LauncherExtensionName
}): LauncherCommandAddress {
  const { builtInId, commandName, extensionName } = params

  if (builtInId) {
    return {
      builtInId,
      commandName,
      kind: "built-in-command"
    }
  }

  return {
    commandName,
    extensionName: extensionName as LauncherExtensionName,
    kind: "extension-command"
  }
}

function getLauncherCommandKey(address: LauncherCommandAddress): string {
  return address.kind === "built-in-command"
    ? `${address.builtInId}:${address.commandName}`
    : `${address.extensionName}:${address.commandName}`
}

export function getLauncherCommandOwnerId(address: LauncherCommandAddress): string {
  return address.kind === "built-in-command" ? address.builtInId : address.extensionName
}

export function getLauncherCommandOwnerDefinition(
  address: LauncherCommandAddress
): LauncherPluginDefinition {
  if (address.kind === "built-in-command") {
    const plugin = builtInLauncherPluginMap.get(address.builtInId)
    if (!plugin) {
      throw new Error(`Unknown built-in launcher command owner "${address.builtInId}"`)
    }

    return plugin
  }

  const plugin = extensionLauncherPluginMap.get(address.extensionName)
  if (!plugin) {
    throw new Error(`Unknown launcher extension "${address.extensionName}"`)
  }

  return plugin
}

export function listLauncherCommands(): LauncherIndexedCommand[] {
  return [
    ...builtInLauncherPlugins.flatMap((plugin) =>
      plugin.manifest.commands.map((command) => ({
        address: createLauncherCommandAddress({
          builtInId: plugin.manifest.id as LauncherBuiltInId,
          commandName: command.name
        }),
        description: command.description ?? "",
        keywords: command.keywords ?? [],
        ownerTitle: plugin.manifest.displayName,
        title: command.title ?? command.name
      }))
    ),
    ...extensionLauncherPlugins.flatMap((plugin) =>
      plugin.manifest.commands.map((command) => ({
        address: createLauncherCommandAddress({
          commandName: command.name,
          extensionName: plugin.manifest.id as LauncherExtensionName
        }),
        description: command.description ?? "",
        keywords: command.keywords ?? [],
        ownerTitle: plugin.manifest.displayName,
        title: command.title ?? command.name
      }))
    )
  ]
}

export function getLauncherExtensionDefaultCommandAddress(
  extensionName: LauncherExtensionName
): LauncherCommandAddress {
  const plugin = extensionLauncherPluginMap.get(extensionName)
  if (!plugin) {
    throw new Error(`Unknown launcher extension "${extensionName}"`)
  }

  return {
    commandName: plugin.manifest.defaultCommandName,
    extensionName,
    kind: "extension-command"
  }
}

export function getLauncherCommandDefinition(address: LauncherCommandAddress): {
  command: LauncherPluginCommandDefinition
  plugin: LauncherPluginDefinition
} {
  const resolved =
    address.kind === "built-in-command"
      ? builtInCommandMap.get(getLauncherCommandKey(address))
      : extensionCommandMap.get(getLauncherCommandKey(address))

  if (!resolved) {
    throw new Error(`Unknown launcher command "${getLauncherCommandKey(address)}"`)
  }

  return resolved
}

export function getLauncherCommandIntents(params: {
  copy: AppCopy
  locale: AppLocale
  query: string
}): LauncherResolvedCommandIntent[] {
  const intents = [
    ...builtInLauncherPlugins.flatMap((plugin) =>
      plugin.commands.flatMap((command) =>
        (command.buildIntentItems?.(params) ?? []).map((item) => ({
          address: createLauncherCommandAddress({
            builtInId: plugin.manifest.id as LauncherBuiltInId,
            commandName: item.commandName ?? command.commandName
          }),
          id: item.id,
          kind: item.kind,
          openOptions: item.openOptions,
          presentation: item.presentation,
          priority: item.priority,
          subtitle: item.subtitle,
          title: item.title
        }))
      )
    ),
    ...extensionLauncherPlugins.flatMap((plugin) =>
      plugin.commands.flatMap((command) =>
        (command.buildIntentItems?.(params) ?? []).map((item) => ({
          address: createLauncherCommandAddress({
            commandName: item.commandName ?? command.commandName,
            extensionName: plugin.manifest.id as LauncherExtensionName
          }),
          id: item.id,
          kind: item.kind,
          openOptions: item.openOptions,
          presentation: item.presentation,
          priority: item.priority,
          subtitle: item.subtitle,
          title: item.title
        }))
      )
    )
  ]

  return intents.sort((left, right) => {
    const rightPriority = typeof right.priority === "number" ? right.priority : 0
    const leftPriority = typeof left.priority === "number" ? left.priority : 0
    return rightPriority - leftPriority
  })
}

export function resolveLauncherCommand(params: LauncherCommandParams): {
  address: LauncherCommandAddress
  match: LauncherCommandMatch
} | null {
  for (const plugin of builtInLauncherPlugins) {
    for (const command of plugin.commands) {
      const match = command.resolveCommand?.(params)
      if (match) {
        return {
          address: createLauncherCommandAddress({
            builtInId: plugin.manifest.id as LauncherBuiltInId,
            commandName: match.commandName ?? command.commandName
          }),
          match
        }
      }
    }
  }

  for (const plugin of extensionLauncherPlugins) {
    for (const command of plugin.commands) {
      const match = command.resolveCommand?.(params)
      if (match) {
        return {
          address: createLauncherCommandAddress({
            commandName: match.commandName ?? command.commandName,
            extensionName: plugin.manifest.id as LauncherExtensionName
          }),
          match
        }
      }
    }
  }

  return null
}
