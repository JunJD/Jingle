import type { LauncherIndexedCommand } from "./pages"
import type { LauncherCommandAddress } from "./pages/types"

export function getLauncherCommandAddressKey(address: LauncherCommandAddress): string {
  return address.kind === "built-in-command"
    ? `${address.builtInId}:${address.commandName}`
    : `${address.extensionName}:${address.commandName}`
}

export function splitLauncherUseWithCommands(
  commands: LauncherIndexedCommand[],
  disabledCommandKeys: readonly string[]
): {
  availableCommands: LauncherIndexedCommand[]
  enabledCommands: LauncherIndexedCommand[]
} {
  const disabledKeySet = new Set(disabledCommandKeys)

  return {
    availableCommands: commands.filter((command) =>
      disabledKeySet.has(getLauncherCommandAddressKey(command.address))
    ),
    enabledCommands: commands.filter(
      (command) => !disabledKeySet.has(getLauncherCommandAddressKey(command.address))
    )
  }
}

export function setLauncherUseWithCommandEnabled(
  disabledCommandKeys: readonly string[],
  commandKey: string,
  enabled: boolean
): string[] {
  if (enabled) {
    return disabledCommandKeys.filter((key) => key !== commandKey)
  }

  return [...new Set([...disabledCommandKeys, commandKey])]
}
