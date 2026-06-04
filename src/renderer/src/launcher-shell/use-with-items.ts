import type { AppCopy } from "../lib/i18n/messages"
import type { LauncherIndexedCommand } from "./pages"
import type { LauncherResolvedCommandIntent } from "./pages/types"
import type { LauncherResultPresentation } from "./result-types"
import type { LauncherShellItem } from "./types"
import { getLauncherCommandAddressKey, splitLauncherUseWithCommands } from "./use-with-preferences"

function normalizeLauncherCommandSearchText(value: string): string {
  return value.trim().toLowerCase()
}

function isHighConfidenceCommandMatch(command: LauncherIndexedCommand, query: string): boolean {
  const normalizedQuery = normalizeLauncherCommandSearchText(query)
  if (!normalizedQuery) {
    return false
  }
  const normalizedTitle = normalizeLauncherCommandSearchText(command.title)
  const normalizedOwnerTitle = normalizeLauncherCommandSearchText(command.ownerTitle)
  const normalizedKeywords = command.keywords.map(normalizeLauncherCommandSearchText)

  return (
    normalizedTitle === normalizedQuery ||
    normalizedTitle.startsWith(`${normalizedQuery} `) ||
    normalizedOwnerTitle === normalizedQuery ||
    normalizedOwnerTitle.startsWith(`${normalizedQuery} `) ||
    normalizedKeywords.some(
      (keyword) => keyword === normalizedQuery || normalizedQuery.startsWith(`${keyword} `)
    )
  )
}

export function buildLauncherCommandIntentShellItems(
  items: LauncherResolvedCommandIntent[]
): LauncherShellItem[] {
  return items.map((item) => ({
    action: {
      executor: "internal",
      target: null,
      type: "none"
    },
    commandOpenOptions: item.openOptions,
    commandRef: item.address,
    id: item.id,
    kind: item.kind,
    presentation: item.presentation,
    subtitle: item.subtitle,
    title: item.title
  }))
}

export function getLauncherIndexedCommandIcon(
  command: LauncherIndexedCommand
): LauncherResultPresentation["icon"] {
  if (command.address.kind === "extension-command") {
    const icon: LauncherResultPresentation["icon"] = {
      extensionName: command.address.extensionName,
      type: "extension"
    }
    if (command.icon) {
      icon.icon = command.icon
    }
    if (command.iconName) {
      icon.iconName = command.iconName
    }

    return icon
  }

  return {
    name: command.iconName ?? "search",
    type: "glyph"
  }
}

export function buildLauncherUseWithCommandShellItems(
  copy: AppCopy,
  commands: LauncherIndexedCommand[],
  query: string
): LauncherShellItem[] {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return []
  }

  return commands.map((command) => ({
    action: {
      executor: "internal" as const,
      target: null,
      type: "none" as const
    },
    commandOpenOptions: {
      launchProps: {
        fallbackText: trimmedQuery
      },
      seedQuery: trimmedQuery
    },
    commandRef: command.address,
    id:
      command.address.kind === "built-in-command"
        ? `use-with:${command.address.builtInId}:${command.address.commandName}:${trimmedQuery}`
        : `use-with:${command.address.extensionName}:${command.address.commandName}:${trimmedQuery}`,
    kind: "plugin" as const,
    presentation: {
      categoryLabel: copy.launcher.resultKindExtension,
      icon: getLauncherIndexedCommandIcon(command),
      listActionLabel: copy.launcher.openGeneric,
      primaryActionLabel: copy.launcher.openGeneric,
      tone: "neutral" as const
    },
    subtitle: [command.ownerTitle, command.description].filter(Boolean).join(" · "),
    title: command.title
  }))
}

export function buildLauncherUseWithShellItems(params: {
  commands: LauncherIndexedCommand[]
  copy: AppCopy
  disabledCommandKeys?: readonly string[]
  excludeCommandKeys?: readonly string[]
  intentItems: LauncherResolvedCommandIntent[]
  query: string
}): LauncherShellItem[] {
  const { enabledCommands } = splitLauncherUseWithCommands(
    params.commands,
    params.disabledCommandKeys ?? []
  )
  const excludedCommandKeys = new Set(params.excludeCommandKeys ?? [])
  const visibleCommands = enabledCommands.filter(
    (command) => !excludedCommandKeys.has(getLauncherCommandAddressKey(command.address))
  )
  const enabledCommandKeys = new Set(
    visibleCommands.map((command) => getLauncherCommandAddressKey(command.address))
  )
  const extensionIntentItems = params.intentItems.filter(
    (item) =>
      item.address.kind === "extension-command" &&
      enabledCommandKeys.has(getLauncherCommandAddressKey(item.address))
  )
  const intentCommandKeys = new Set(
    extensionIntentItems.map((item) => getLauncherCommandAddressKey(item.address))
  )
  const fallbackCommands = visibleCommands.filter(
    (command) => !intentCommandKeys.has(getLauncherCommandAddressKey(command.address))
  )

  return [
    ...buildLauncherCommandIntentShellItems(extensionIntentItems),
    ...buildLauncherUseWithCommandShellItems(params.copy, fallbackCommands, params.query)
  ]
}

export function buildHighConfidenceUseWithCommandShellItems(params: {
  commands: LauncherIndexedCommand[]
  copy: AppCopy
  disabledCommandKeys?: readonly string[]
  excludeCommandKeys?: readonly string[]
  query: string
}): LauncherShellItem[] {
  const { enabledCommands } = splitLauncherUseWithCommands(
    params.commands,
    params.disabledCommandKeys ?? []
  )
  const excludedCommandKeys = new Set(params.excludeCommandKeys ?? [])
  const matchedCommands = enabledCommands.filter(
    (command) =>
      !excludedCommandKeys.has(getLauncherCommandAddressKey(command.address)) &&
      isHighConfidenceCommandMatch(command, params.query)
  )

  return buildLauncherUseWithCommandShellItems(params.copy, matchedCommands, params.query)
}
