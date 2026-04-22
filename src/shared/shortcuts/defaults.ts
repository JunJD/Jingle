import { LAUNCHER_COMMAND_IDS } from "./ids"
import type { ShortcutBindingDefinition, ShortcutPlatform } from "./model"

export const DEFAULT_SHORTCUT_BINDINGS: readonly ShortcutBindingDefinition[] = [
  {
    commandId: LAUNCHER_COMMAND_IDS.toggle,
    scope: "global",
    chord: {
      modifiers: ["meta", "shift"],
      key: "Space"
    },
    platform: "darwin"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.toggle,
    scope: "global",
    chord: {
      modifiers: ["ctrl", "shift"],
      key: "Space"
    },
    platform: "win32"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.toggle,
    scope: "global",
    chord: {
      modifiers: ["ctrl", "shift"],
      key: "Space"
    },
    platform: "linux"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.close,
    scope: "launcher",
    chord: {
      modifiers: [],
      key: "Escape"
    },
    allowInTextInput: true,
    preventDefault: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.searchOpenAi,
    scope: "launcher.home",
    chord: {
      modifiers: [],
      key: "Tab"
    },
    allowInTextInput: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.searchOpenAi,
    scope: "launcher.home",
    chord: {
      modifiers: ["meta"],
      key: "]",
      code: "BracketRight"
    },
    allowInTextInput: true,
    platform: "darwin"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.searchOpenAi,
    scope: "launcher.home",
    chord: {
      modifiers: ["alt"],
      key: "ArrowRight"
    },
    allowInTextInput: true,
    platform: "win32"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.searchOpenAi,
    scope: "launcher.home",
    chord: {
      modifiers: ["alt"],
      key: "ArrowRight"
    },
    allowInTextInput: true,
    platform: "linux"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.searchOpenSettings,
    scope: "launcher.home",
    chord: {
      modifiers: ["meta"],
      key: ",",
      code: "Comma"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "darwin"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.searchOpenSettings,
    scope: "launcher.home",
    chord: {
      modifiers: ["ctrl"],
      key: ",",
      code: "Comma"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "win32"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.searchOpenSettings,
    scope: "launcher.home",
    chord: {
      modifiers: ["ctrl"],
      key: ",",
      code: "Comma"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "linux"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.searchMoveSelectionDown,
    scope: "launcher.home",
    chord: {
      modifiers: [],
      key: "ArrowDown"
    },
    allowInTextInput: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.searchMoveSelectionUp,
    scope: "launcher.home",
    chord: {
      modifiers: [],
      key: "ArrowUp"
    },
    allowInTextInput: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.searchExecuteSelection,
    scope: "launcher.home",
    chord: {
      modifiers: [],
      key: "Enter"
    },
    allowInTextInput: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiGoHome,
    scope: "launcher.ai",
    chord: {
      modifiers: [],
      key: "Backspace"
    },
    allowInTextInput: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiGoToPreviousChat,
    scope: "launcher.ai",
    chord: {
      modifiers: ["meta"],
      key: "[",
      code: "BracketLeft"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "darwin"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiGoToPreviousChat,
    scope: "launcher.ai",
    chord: {
      modifiers: ["alt"],
      key: "ArrowLeft"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "win32"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiGoToPreviousChat,
    scope: "launcher.ai",
    chord: {
      modifiers: ["alt"],
      key: "ArrowLeft"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "linux"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiGoToNextChat,
    scope: "launcher.ai",
    chord: {
      modifiers: ["meta"],
      key: "]",
      code: "BracketRight"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "darwin"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiGoToNextChat,
    scope: "launcher.ai",
    chord: {
      modifiers: ["alt"],
      key: "ArrowRight"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "win32"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiGoToNextChat,
    scope: "launcher.ai",
    chord: {
      modifiers: ["alt"],
      key: "ArrowRight"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "linux"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiSubmit,
    scope: "launcher.ai",
    chord: {
      modifiers: [],
      key: "Enter"
    },
    allowInTextInput: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiAddAttachment,
    scope: "launcher.ai",
    chord: {
      modifiers: ["meta", "shift"],
      key: "A",
      code: "KeyA"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "darwin"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiAddAttachment,
    scope: "launcher.ai",
    chord: {
      modifiers: ["ctrl", "shift"],
      key: "A",
      code: "KeyA"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "win32"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiAddAttachment,
    scope: "launcher.ai",
    chord: {
      modifiers: ["ctrl", "shift"],
      key: "A",
      code: "KeyA"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "linux"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiNewQuestion,
    scope: "launcher.ai",
    chord: {
      modifiers: ["meta"],
      key: "N",
      code: "KeyN"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "darwin"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiNewQuestion,
    scope: "launcher.ai",
    chord: {
      modifiers: ["ctrl"],
      key: "N",
      code: "KeyN"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "win32"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiNewQuestion,
    scope: "launcher.ai",
    chord: {
      modifiers: ["ctrl"],
      key: "N",
      code: "KeyN"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "linux"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiChangeModel,
    scope: "launcher.ai",
    chord: {
      modifiers: ["meta", "shift"],
      key: "M",
      code: "KeyM"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "darwin"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiChangeModel,
    scope: "launcher.ai",
    chord: {
      modifiers: ["ctrl", "shift"],
      key: "M",
      code: "KeyM"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "win32"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiChangeModel,
    scope: "launcher.ai",
    chord: {
      modifiers: ["ctrl", "shift"],
      key: "M",
      code: "KeyM"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "linux"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiBranchChat,
    scope: "launcher.ai",
    chord: {
      modifiers: ["meta", "shift"],
      key: "B",
      code: "KeyB"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "darwin"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiBranchChat,
    scope: "launcher.ai",
    chord: {
      modifiers: ["ctrl", "shift"],
      key: "B",
      code: "KeyB"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "win32"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiBranchChat,
    scope: "launcher.ai",
    chord: {
      modifiers: ["ctrl", "shift"],
      key: "B",
      code: "KeyB"
    },
    allowInTextInput: true,
    preventDefault: true,
    platform: "linux"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.listMoveSelectionDown,
    scope: "launcher.list",
    chord: {
      modifiers: [],
      key: "ArrowDown"
    },
    allowInTextInput: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.listMoveSelectionUp,
    scope: "launcher.list",
    chord: {
      modifiers: [],
      key: "ArrowUp"
    },
    allowInTextInput: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.actionsOpen,
    scope: "launcher",
    chord: {
      modifiers: ["meta"],
      key: "K",
      code: "KeyK"
    },
    allowInTextInput: true,
    platform: "darwin"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.actionsOpen,
    scope: "launcher",
    chord: {
      modifiers: ["ctrl"],
      key: "K",
      code: "KeyK"
    },
    allowInTextInput: true,
    platform: "win32"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.actionsOpen,
    scope: "launcher",
    chord: {
      modifiers: ["ctrl"],
      key: "K",
      code: "KeyK"
    },
    allowInTextInput: true,
    platform: "linux"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.actionsExecutePrimary,
    scope: "launcher",
    chord: {
      modifiers: [],
      key: "Enter"
    },
    allowInTextInput: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.actionPanelClose,
    scope: "launcher.action-panel",
    chord: {
      modifiers: [],
      key: "Escape"
    },
    allowInTextInput: true,
    preventDefault: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.actionPanelMoveSelectionDown,
    scope: "launcher.action-panel",
    chord: {
      modifiers: [],
      key: "ArrowDown"
    },
    allowInTextInput: true,
    preventDefault: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.actionPanelMoveSelectionUp,
    scope: "launcher.action-panel",
    chord: {
      modifiers: [],
      key: "ArrowUp"
    },
    allowInTextInput: true,
    preventDefault: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.actionPanelExecuteSelection,
    scope: "launcher.action-panel",
    chord: {
      modifiers: [],
      key: "Enter"
    },
    allowInTextInput: true,
    preventDefault: true
  }
]

function matchesShortcutPlatform(
  binding: ShortcutBindingDefinition,
  platform?: ShortcutPlatform
): boolean {
  return binding.platform === undefined || platform === undefined || binding.platform === platform
}

export function listDefaultShortcutBindings(): readonly ShortcutBindingDefinition[] {
  return DEFAULT_SHORTCUT_BINDINGS
}

export function getDefaultShortcutBindingsForCommand(
  commandId: string,
  platform?: ShortcutPlatform
): readonly ShortcutBindingDefinition[] {
  return DEFAULT_SHORTCUT_BINDINGS.filter(
    (binding) => binding.commandId === commandId && matchesShortcutPlatform(binding, platform)
  )
}

export function getPrimaryDefaultShortcutBinding(
  commandId: string,
  platform?: ShortcutPlatform
): ShortcutBindingDefinition | null {
  return getDefaultShortcutBindingsForCommand(commandId, platform)[0] ?? null
}
