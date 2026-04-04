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
    preventDefault: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.searchOpenAi,
    scope: "launcher.home",
    chord: {
      modifiers: [],
      key: "Tab"
    },
    allowInTextInput: true,
    preventDefault: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.searchMoveSelectionDown,
    scope: "launcher.home",
    chord: {
      modifiers: [],
      key: "ArrowDown"
    },
    allowInTextInput: true,
    preventDefault: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.searchMoveSelectionUp,
    scope: "launcher.home",
    chord: {
      modifiers: [],
      key: "ArrowUp"
    },
    allowInTextInput: true,
    preventDefault: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.searchExecuteSelection,
    scope: "launcher.home",
    chord: {
      modifiers: [],
      key: "Enter"
    },
    allowInTextInput: true,
    preventDefault: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.aiSubmit,
    scope: "launcher.ai",
    chord: {
      modifiers: [],
      key: "Enter"
    },
    allowInTextInput: true,
    preventDefault: true
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.actionsOpen,
    scope: "launcher",
    chord: {
      modifiers: ["meta"],
      key: "K",
      code: "KeyK"
    },
    preventDefault: true,
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
    preventDefault: true,
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
    preventDefault: true,
    platform: "linux"
  },
  {
    commandId: LAUNCHER_COMMAND_IDS.actionsExecutePrimary,
    scope: "launcher",
    chord: {
      modifiers: [],
      key: "Enter"
    },
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
