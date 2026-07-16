export type RuntimeKeyboardModifier = "cmd" | "ctrl" | "opt" | "shift"

export interface RuntimeKeyboardShortcutPlatform {
  key: string
  modifiers: RuntimeKeyboardModifier[]
}

export interface RuntimeKeyboardShortcut {
  macOS?: RuntimeKeyboardShortcutPlatform
  Windows?: RuntimeKeyboardShortcutPlatform
  Linux?: RuntimeKeyboardShortcutPlatform
}

export const Keyboard = {
  Shortcut: {
    Common: {
      Copy: {
        macOS: { key: "c", modifiers: ["cmd"] },
        Windows: { key: "c", modifiers: ["ctrl"] },
        Linux: { key: "c", modifiers: ["ctrl"] }
      },
      CopyName: {
        macOS: { key: "c", modifiers: ["cmd", "shift"] },
        Windows: { key: "c", modifiers: ["ctrl", "shift"] },
        Linux: { key: "c", modifiers: ["ctrl", "shift"] }
      },
      CopyPath: {
        macOS: { key: "c", modifiers: ["cmd", "opt"] },
        Windows: { key: "c", modifiers: ["ctrl", "opt"] },
        Linux: { key: "c", modifiers: ["ctrl", "opt"] }
      },
      New: {
        macOS: { key: "n", modifiers: ["cmd"] },
        Windows: { key: "n", modifiers: ["ctrl"] },
        Linux: { key: "n", modifiers: ["ctrl"] }
      },
      Pin: {
        macOS: { key: "p", modifiers: ["cmd", "shift"] },
        Windows: { key: "p", modifiers: ["ctrl", "shift"] },
        Linux: { key: "p", modifiers: ["ctrl", "shift"] }
      },
      Remove: {
        macOS: { key: "x", modifiers: ["ctrl"] },
        Windows: { key: "backspace", modifiers: ["ctrl"] },
        Linux: { key: "backspace", modifiers: ["ctrl"] }
      }
    }
  }
} satisfies {
  Shortcut: {
    Common: Record<string, RuntimeKeyboardShortcut>
  }
}

export namespace Keyboard {
  export type Shortcut = RuntimeKeyboardShortcut
}
