import type { AppCopy } from "../lib/i18n/messages"
import type { LauncherIndexedCommand } from "./pages"
import type { LauncherResolvedCommandIntent } from "./pages/types"
import type { LauncherResultPresentation } from "./result-types"
import type { LauncherShellItem } from "./types"
import { getLauncherCommandAddressKey, splitLauncherUseWithCommands } from "./use-with-preferences"

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
    return {
      extensionName: command.address.extensionName,
      icon: command.icon,
      iconName: command.iconName,
      type: "extension"
    }
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
  intentItems: LauncherResolvedCommandIntent[]
  query: string
}): LauncherShellItem[] {
  const { enabledCommands } = splitLauncherUseWithCommands(
    params.commands,
    params.disabledCommandKeys ?? []
  )
  const enabledCommandKeys = new Set(
    enabledCommands.map((command) => getLauncherCommandAddressKey(command.address))
  )
  const extensionIntentItems = params.intentItems.filter(
    (item) =>
      item.address.kind === "extension-command" &&
      enabledCommandKeys.has(getLauncherCommandAddressKey(item.address))
  )
  const intentCommandKeys = new Set(
    extensionIntentItems.map((item) => getLauncherCommandAddressKey(item.address))
  )
  const fallbackCommands = enabledCommands.filter(
    (command) => !intentCommandKeys.has(getLauncherCommandAddressKey(command.address))
  )

  return [
    ...buildLauncherCommandIntentShellItems(extensionIntentItems),
    ...buildLauncherUseWithCommandShellItems(params.copy, fallbackCommands, params.query)
  ]
}
