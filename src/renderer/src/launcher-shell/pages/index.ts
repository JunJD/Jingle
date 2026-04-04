import type { AppCopy } from "@/lib/i18n/messages"
import type { AppLocale } from "@shared/i18n"
import { AI_CHAT_COMMAND_NAME, AI_LAUNCHER_PLUGIN_ID } from "@shared/launcher-ai"
import { aiBuiltInCommandOwner } from "@ai-core/command"
import { nativeLauncherCommandOwners } from "@extension-host/index"
import type {
  LauncherBuiltInCommandAddress,
  LauncherBuiltInId,
  LauncherCommandAddress,
  LauncherCommandDefinition,
  LauncherCommandMatch,
  LauncherCommandName,
  LauncherCommandOwnerDefinition,
  LauncherCommandParams,
  LauncherExtensionName,
  LauncherResolvedCommandIntent
} from "./types"

const builtInLauncherCommandOwners: LauncherCommandOwnerDefinition[] = [aiBuiltInCommandOwner]
const extensionLauncherCommandOwners: LauncherCommandOwnerDefinition[] = nativeLauncherCommandOwners

const builtInLauncherCommandOwnerMap = new Map(
  builtInLauncherCommandOwners.map((owner) => [owner.manifest.id as LauncherBuiltInId, owner] as const)
)

const extensionLauncherCommandOwnerMap = new Map(
  extensionLauncherCommandOwners.map(
    (owner) => [owner.manifest.id as LauncherExtensionName, owner] as const
  )
)

const builtInCommandMap = new Map(
  builtInLauncherCommandOwners.flatMap((owner) =>
    owner.commands.map((command) => [
      `${owner.manifest.id}:${command.commandName}`,
      { command, owner } as const
    ])
  )
)

const extensionCommandMap = new Map(
  extensionLauncherCommandOwners.flatMap((owner) =>
    owner.commands.map((command) => [
      `${owner.manifest.id}:${command.commandName}`,
      { command, owner } as const
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
): LauncherCommandOwnerDefinition {
  if (address.kind === "built-in-command") {
    const owner = builtInLauncherCommandOwnerMap.get(address.builtInId)
    if (!owner) {
      throw new Error(`Unknown built-in launcher command owner "${address.builtInId}"`)
    }

    return owner
  }

  const owner = extensionLauncherCommandOwnerMap.get(address.extensionName)
  if (!owner) {
    throw new Error(`Unknown launcher extension "${address.extensionName}"`)
  }

  return owner
}

export function listLauncherCommands(): LauncherIndexedCommand[] {
  return [
    ...builtInLauncherCommandOwners.flatMap((owner) =>
      owner.manifest.commands.map((command) => ({
        address: createLauncherCommandAddress({
          builtInId: owner.manifest.id as LauncherBuiltInId,
          commandName: command.name
        }),
        description: command.description ?? "",
        keywords: command.keywords ?? [],
        ownerTitle: owner.manifest.displayName,
        title: command.title ?? command.name
      }))
    ),
    ...extensionLauncherCommandOwners.flatMap((owner) =>
      owner.manifest.commands.map((command) => ({
        address: createLauncherCommandAddress({
          commandName: command.name,
          extensionName: owner.manifest.id as LauncherExtensionName
        }),
        description: command.description ?? "",
        keywords: command.keywords ?? [],
        ownerTitle: owner.manifest.displayName,
        title: command.title ?? command.name
      }))
    )
  ]
}

export function getLauncherExtensionDefaultCommandAddress(
  extensionName: LauncherExtensionName
): LauncherCommandAddress {
  const owner = extensionLauncherCommandOwnerMap.get(extensionName)
  if (!owner) {
    throw new Error(`Unknown launcher extension "${extensionName}"`)
  }

  return {
    commandName: owner.manifest.defaultCommandName,
    extensionName,
    kind: "extension-command"
  }
}

export function getLauncherCommandDefinition(address: LauncherCommandAddress): {
  command: LauncherCommandDefinition
  owner: LauncherCommandOwnerDefinition
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
    ...builtInLauncherCommandOwners.flatMap((owner) =>
      owner.commands.flatMap((command) =>
        (command.buildIntentItems?.(params) ?? []).map((item) => ({
          address: createLauncherCommandAddress({
            builtInId: owner.manifest.id as LauncherBuiltInId,
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
    ...extensionLauncherCommandOwners.flatMap((owner) =>
      owner.commands.flatMap((command) =>
        (command.buildIntentItems?.(params) ?? []).map((item) => ({
          address: createLauncherCommandAddress({
            commandName: item.commandName ?? command.commandName,
            extensionName: owner.manifest.id as LauncherExtensionName
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
  for (const owner of builtInLauncherCommandOwners) {
    for (const command of owner.commands) {
      const match = command.resolveCommand?.(params)
      if (match) {
        return {
          address: createLauncherCommandAddress({
            builtInId: owner.manifest.id as LauncherBuiltInId,
            commandName: match.commandName ?? command.commandName
          }),
          match
        }
      }
    }
  }

  for (const owner of extensionLauncherCommandOwners) {
    for (const command of owner.commands) {
      const match = command.resolveCommand?.(params)
      if (match) {
        return {
          address: createLauncherCommandAddress({
            commandName: match.commandName ?? command.commandName,
            extensionName: owner.manifest.id as LauncherExtensionName
          }),
          match
        }
      }
    }
  }

  return null
}
