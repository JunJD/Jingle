import type {
  ShortcutBindingDefinition,
  ShortcutChord,
  ShortcutModifier,
  ShortcutPlatform
} from "@shared/shortcuts/model"
import { resolveShortcutPlatform } from "@shared/shortcuts/model"
import { getPrimaryLauncherShortcutBinding } from "./command-registry"

const DARWIN_MODIFIER_ORDER: readonly ShortcutModifier[] = ["meta", "shift", "alt", "ctrl"]
const DEFAULT_MODIFIER_ORDER: readonly ShortcutModifier[] = ["ctrl", "alt", "shift", "meta"]

const DARWIN_MODIFIER_LABELS: Record<ShortcutModifier, string> = {
  meta: "⌘",
  shift: "⇧",
  alt: "⌥",
  ctrl: "⌃"
}

const DEFAULT_MODIFIER_LABELS: Record<ShortcutModifier, string> = {
  meta: "Meta",
  shift: "Shift",
  alt: "Alt",
  ctrl: "Ctrl"
}

const KEY_LABELS: Record<string, string> = {
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  Backspace: "⌫",
  Delete: "⌦",
  Enter: "↵",
  Escape: "Esc",
  Home: "Home",
  End: "End",
  Space: "Space",
  Tab: "Tab"
}

function sortShortcutModifiers(
  modifiers: readonly ShortcutModifier[],
  platform: ShortcutPlatform
): ShortcutModifier[] {
  const order = platform === "darwin" ? DARWIN_MODIFIER_ORDER : DEFAULT_MODIFIER_ORDER
  return [...modifiers].sort((left, right) => order.indexOf(left) - order.indexOf(right))
}

function formatShortcutKey(key: string): string {
  if (KEY_LABELS[key]) {
    return KEY_LABELS[key]
  }

  return key.length === 1 ? key.toUpperCase() : key
}

export function formatShortcutChord(chord: ShortcutChord, platform: ShortcutPlatform): string {
  const modifierLabels = sortShortcutModifiers(chord.modifiers, platform).map((modifier) =>
    platform === "darwin" ? DARWIN_MODIFIER_LABELS[modifier] : DEFAULT_MODIFIER_LABELS[modifier]
  )
  const keyLabel = formatShortcutKey(chord.key)

  if (platform === "darwin") {
    return [...modifierLabels, keyLabel].join("")
  }

  return [...modifierLabels, keyLabel].join("+")
}

export function formatShortcutBinding(
  binding: ShortcutBindingDefinition,
  platform: ShortcutPlatform
): string {
  return formatShortcutChord(binding.chord, platform)
}

export function formatLauncherCommandShortcut(
  commandId: string,
  platform = resolveShortcutPlatform(window.electron.process.platform)
): string | null {
  const binding = getPrimaryLauncherShortcutBinding(commandId, platform)
  return binding ? formatShortcutBinding(binding, platform) : null
}
