import {
  getDefaultShortcutBindingsForCommand,
  getPrimaryDefaultShortcutBinding
} from "../../../shared/shortcuts/defaults"
import { LAUNCHER_COMMAND_IDS } from "../../../shared/shortcuts/ids"
import type {
  ShortcutBindingDefinition,
  ShortcutCommandDefinition,
  ShortcutPlatform
} from "../../../shared/shortcuts/model"

const LAUNCHER_SHORTCUT_COMMANDS: readonly ShortcutCommandDefinition[] = [
  {
    id: LAUNCHER_COMMAND_IDS.toggle,
    title: "Show Launcher",
    description: "Show or hide the launcher window",
    category: "global"
  },
  {
    id: LAUNCHER_COMMAND_IDS.close,
    title: "Close Launcher",
    description: "Close the active launcher surface",
    category: "launcher"
  },
  {
    id: LAUNCHER_COMMAND_IDS.searchOpenAi,
    title: "Ask AI",
    description: "Open the launcher AI page from home search",
    category: "launcher"
  },
  {
    id: LAUNCHER_COMMAND_IDS.searchMoveSelectionDown,
    title: "Move Selection Down",
    description: "Move the launcher home selection down",
    category: "launcher"
  },
  {
    id: LAUNCHER_COMMAND_IDS.searchMoveSelectionUp,
    title: "Move Selection Up",
    description: "Move the launcher home selection up",
    category: "launcher"
  },
  {
    id: LAUNCHER_COMMAND_IDS.searchExecuteSelection,
    title: "Open Selected Result",
    description: "Run the selected launcher home result",
    category: "launcher"
  },
  {
    id: LAUNCHER_COMMAND_IDS.aiSubmit,
    title: "Submit AI Prompt",
    description: "Run the primary launcher AI action",
    category: "ai"
  },
  {
    id: LAUNCHER_COMMAND_IDS.actionsOpen,
    title: "Open Action Panel",
    description: "Open the launcher action panel",
    category: "launcher"
  },
  {
    id: LAUNCHER_COMMAND_IDS.actionsExecutePrimary,
    title: "Run Primary Action",
    description: "Run the primary action for the current launcher surface",
    category: "launcher"
  }
] as const

const launcherShortcutCommandMap = new Map(
  LAUNCHER_SHORTCUT_COMMANDS.map((command) => [command.id, command] as const)
)

export function listLauncherShortcutCommands(): readonly ShortcutCommandDefinition[] {
  return LAUNCHER_SHORTCUT_COMMANDS
}

export function getLauncherShortcutCommand(commandId: string): ShortcutCommandDefinition {
  const command = launcherShortcutCommandMap.get(commandId)
  if (!command) {
    throw new Error(`Unknown launcher shortcut command "${commandId}"`)
  }

  return command
}

export function getLauncherShortcutBindings(
  commandId: string,
  platform?: ShortcutPlatform
): readonly ShortcutBindingDefinition[] {
  getLauncherShortcutCommand(commandId)
  return getDefaultShortcutBindingsForCommand(commandId, platform)
}

export function getPrimaryLauncherShortcutBinding(
  commandId: string,
  platform?: ShortcutPlatform
): ShortcutBindingDefinition | null {
  getLauncherShortcutCommand(commandId)
  return getPrimaryDefaultShortcutBinding(commandId, platform)
}
