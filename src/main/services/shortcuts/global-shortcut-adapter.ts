import type { ShortcutChord, ShortcutModifier } from "@shared/shortcuts/model"

const MODIFIER_TO_ACCELERATOR: Record<ShortcutModifier, string> = {
  alt: "Alt",
  ctrl: "Ctrl",
  meta: "Command",
  shift: "Shift"
}

const KEY_TO_ACCELERATOR: Record<string, string> = {
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Backspace: "Backspace",
  Delete: "Delete",
  Enter: "Enter",
  Escape: "Esc",
  Space: "Space",
  Tab: "Tab"
}

export function toElectronAccelerator(chord: ShortcutChord): string | null {
  const key =
    KEY_TO_ACCELERATOR[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key)
  if (!key) {
    return null
  }

  return [...chord.modifiers.map((modifier) => MODIFIER_TO_ACCELERATOR[modifier]), key].join("+")
}
