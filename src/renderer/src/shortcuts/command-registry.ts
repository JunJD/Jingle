import { isShortcutCommandConfigurable } from "../../../shared/shortcuts/configurable"
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

function defineLauncherShortcutCommand(
  definition: Omit<ShortcutCommandDefinition, "configurable">
): ShortcutCommandDefinition {
  return {
    ...definition,
    configurable: isShortcutCommandConfigurable(definition.id)
  }
}

const LAUNCHER_SHORTCUT_COMMANDS: readonly ShortcutCommandDefinition[] = [
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.toggle,
    title: "Show Launcher",
    description: "Show or hide the launcher window",
    category: "global"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.close,
    title: "Close Launcher",
    description: "Close the active launcher surface",
    category: "launcher"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.searchOpenAi,
    title: "Ask AI",
    description: "Open the launcher AI page from home search",
    category: "launcher"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.searchMoveSelectionDown,
    title: "Move Selection Down",
    description: "Move the launcher home selection down",
    category: "launcher"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.searchMoveSelectionUp,
    title: "Move Selection Up",
    description: "Move the launcher home selection up",
    category: "launcher"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.searchExecuteSelection,
    title: "Open Selected Result",
    description: "Run the selected launcher home result",
    category: "launcher"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.aiSubmit,
    title: "Submit AI Prompt",
    description: "Run the primary launcher AI action",
    category: "ai"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.aiGoHome,
    title: "Go Back From AI",
    description: "Return to launcher home from an empty AI input",
    category: "ai"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.listMoveSelectionDown,
    title: "Move List Selection Down",
    description: "Move the native list selection down",
    category: "extension"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.listMoveSelectionUp,
    title: "Move List Selection Up",
    description: "Move the native list selection up",
    category: "extension"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.actionsOpen,
    title: "Open Action Panel",
    description: "Open the launcher action panel",
    category: "launcher"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.actionsExecutePrimary,
    title: "Run Primary Action",
    description: "Run the primary action for the current launcher surface",
    category: "launcher"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.actionPanelClose,
    title: "Close Action Panel",
    description: "Close the launcher action panel",
    category: "launcher"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.actionPanelMoveSelectionDown,
    title: "Move Action Selection Down",
    description: "Move the launcher action panel selection down",
    category: "launcher"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.actionPanelMoveSelectionUp,
    title: "Move Action Selection Up",
    description: "Move the launcher action panel selection up",
    category: "launcher"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.actionPanelExecuteSelection,
    title: "Run Selected Action",
    description: "Run the selected launcher action panel item",
    category: "launcher"
  })
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
