import type { AppCopy } from "@/lib/i18n/messages"
import { resolveLocalizedText, type AppLocale } from "@shared/i18n"
import { AI_CHAT_COMMAND_NAME, AI_LAUNCHER_PLUGIN_ID } from "@shared/launcher-ai"
import { aiBuiltInCommandOwner } from "@ai-core/command"
import { getNativeLauncherCommandOwners } from "@extension-host/index"
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

function buildLauncherCommandMap(owners: readonly LauncherCommandOwnerDefinition[]) {
  return new Map(
    owners.flatMap((owner) =>
      owner.commands.map((command) => [
        `${owner.manifest.id}:${command.commandName}`,
        { command, owner } as const
      ])
    )
  )
}

const builtInCommandMap = buildLauncherCommandMap(builtInLauncherCommandOwners)

function getExtensionLauncherCommandOwners(): readonly LauncherCommandOwnerDefinition[] {
  return getNativeLauncherCommandOwners()
}

function getExtensionCommandMap() {
  return buildLauncherCommandMap(getExtensionLauncherCommandOwners())
}

function listAllLauncherCommandOwners(): readonly LauncherCommandOwnerDefinition[] {
  return [...builtInLauncherCommandOwners, ...getExtensionLauncherCommandOwners()]
}

export const DEFAULT_HOME_COMMAND: LauncherBuiltInCommandAddress = {
  builtInId: AI_LAUNCHER_PLUGIN_ID,
  commandName: AI_CHAT_COMMAND_NAME,
  kind: "built-in-command"
}

export interface LauncherIndexedCommand {
  address: LauncherCommandAddress
  description: string
  icon?: string
  iconName?: string
  keywords: string[]
  ownerTitle: string
  title: string
}

/**
 * 为内建命令或扩展命令构造统一的地址对象。
 */
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

/**
 * 把命令地址压平成稳定的 map key。
 */
function getLauncherCommandKey(address: LauncherCommandAddress): string {
  return address.kind === "built-in-command"
    ? `${address.builtInId}:${address.commandName}`
    : `${address.extensionName}:${address.commandName}`
}

/**
 * 返回命令所属 owner 的唯一标识。
 */
export function getLauncherCommandOwnerId(address: LauncherCommandAddress): string {
  return address.kind === "built-in-command" ? address.builtInId : address.extensionName
}

/**
 * 列出可供搜索和展示的全部 launcher 命令元数据。
 */
export function listLauncherCommands(locale: AppLocale): LauncherIndexedCommand[] {
  return listAllLauncherCommandOwners().flatMap((owner) =>
    owner.manifest.commands.map((command) => ({
      address:
        owner.manifest.id === AI_LAUNCHER_PLUGIN_ID
          ? createLauncherCommandAddress({
              builtInId: owner.manifest.id as LauncherBuiltInId,
              commandName: command.name
            })
          : createLauncherCommandAddress({
              commandName: command.name,
              extensionName: owner.manifest.id as LauncherExtensionName
            }),
      description: resolveLocalizedText(command.description, locale),
      icon: command.icon,
      iconName: command.iconName,
      keywords: command.keywords ?? [],
      ownerTitle: resolveLocalizedText(owner.manifest.displayName, locale, owner.manifest.id),
      title: resolveLocalizedText(command.title, locale, command.name)
    }))
  )
}

export function getLauncherIndexedCommand(
  address: LauncherCommandAddress,
  locale: AppLocale
): LauncherIndexedCommand | null {
  const commandKey = getLauncherCommandKey(address)
  return (
    listLauncherCommands(locale).find(
      (command) => getLauncherCommandKey(command.address) === commandKey
    ) ?? null
  )
}

/**
 * 根据命令地址拿到运行时定义和所属 owner。
 */
export function getLauncherCommandDefinition(address: LauncherCommandAddress): {
  command: LauncherCommandDefinition
  owner: LauncherCommandOwnerDefinition
} {
  const resolved =
    address.kind === "built-in-command"
      ? builtInCommandMap.get(getLauncherCommandKey(address))
      : getExtensionCommandMap().get(getLauncherCommandKey(address))

  if (!resolved) {
    throw new Error(`Unknown launcher command "${getLauncherCommandKey(address)}"`)
  }

  return resolved
}

/**
 * 收集所有命令暴露的 intent，并按优先级倒序排序。
 */
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
    ...getExtensionLauncherCommandOwners().flatMap((owner) =>
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

/**
 * 根据输入参数解析出首个匹配的 launcher 命令。
 */
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

  for (const owner of getExtensionLauncherCommandOwners()) {
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
