import type { AppCopy } from "../lib/i18n/messages"
import type { LauncherIndexedCommand } from "./pages"
import type { LauncherCommandAddress, LauncherResolvedCommandIntent } from "./pages/types"
import type { LauncherShellItem } from "./types"

function getLauncherCommandAddressKey(address: LauncherCommandAddress): string {
  return address.kind === "built-in-command"
    ? `${address.builtInId}:${address.commandName}`
    : `${address.extensionName}:${address.commandName}`
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
      icon: {
        name: command.iconName ?? "search",
        type: "glyph" as const
      },
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
  intentItems: LauncherResolvedCommandIntent[]
  query: string
}): LauncherShellItem[] {
  const extensionIntentItems = params.intentItems.filter(
    (item) => item.address.kind === "extension-command"
  )
  const intentCommandKeys = new Set(
    extensionIntentItems.map((item) => getLauncherCommandAddressKey(item.address))
  )
  const fallbackCommands = params.commands.filter(
    (command) => !intentCommandKeys.has(getLauncherCommandAddressKey(command.address))
  )

  return [
    ...buildLauncherCommandIntentShellItems(extensionIntentItems),
    ...buildLauncherUseWithCommandShellItems(params.copy, fallbackCommands, params.query)
  ]
}
