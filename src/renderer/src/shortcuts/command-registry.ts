import { isShortcutCommandConfigurable } from "../../../shared/shortcuts/configurable"
import { LAUNCHER_COMMAND_IDS } from "../../../shared/shortcuts/ids"
import type { ShortcutCommandDefinition } from "../../../shared/shortcuts/model"

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
    title: "Open Launcher AI",
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
    id: LAUNCHER_COMMAND_IDS.aiAddAttachment,
    title: "Add AI Attachment",
    description: "Open the file picker for launcher AI attachments",
    category: "ai"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.aiGoHome,
    title: "Go Home From AI",
    description: "Return to launcher home from the AI page",
    category: "ai"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.aiGoToPreviousChat,
    title: "Go to Previous AI Chat",
    description: "Switch to the previous launcher AI chat",
    category: "ai"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.aiGoToNextChat,
    title: "Go to Next AI Chat",
    description: "Switch to the next launcher AI chat",
    category: "ai"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.aiNewQuestion,
    title: "New AI Question",
    description: "Start a fresh launcher AI question",
    category: "ai"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.aiChangeModel,
    title: "Change AI Model",
    description: "Open the launcher AI model picker",
    category: "ai"
  }),
  defineLauncherShortcutCommand({
    id: LAUNCHER_COMMAND_IDS.aiBranchChat,
    title: "Branch AI Chat",
    description: "Branch the current launcher AI chat into a new thread",
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
