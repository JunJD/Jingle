import { formatShortcutChord } from "@/shortcuts/format-shortcut"
import type { ExtensionActionNode } from "@shared/extension-runtime-protocol"
import {
  resolveShortcutPlatform,
  type ShortcutChord,
  type ShortcutModifier,
  type ShortcutPlatform
} from "@shared/shortcuts/model"

const RUNTIME_ACTION_MODIFIER_MAP: Record<string, ShortcutModifier> = {
  cmd: "meta",
  ctrl: "ctrl",
  opt: "alt",
  shift: "shift"
}

const RUNTIME_ACTION_SPECIAL_KEYS: Record<string, string> = {
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  backspace: "Backspace",
  delete: "Delete",
  enter: "Enter",
  escape: "Escape",
  space: "Space",
  tab: "Tab"
}

export function toLauncherActionShortcut(
  actionShortcut: ExtensionActionNode["shortcut"]
): ShortcutChord | undefined {
  if (!actionShortcut) {
    return undefined
  }

  const modifiers = actionShortcut.modifiers.flatMap((modifier) => {
    const mappedModifier = RUNTIME_ACTION_MODIFIER_MAP[modifier]
    return mappedModifier ? [mappedModifier] : []
  })
  const rawKey = actionShortcut.key.trim()
  const key = RUNTIME_ACTION_SPECIAL_KEYS[rawKey.toLowerCase()] ?? rawKey

  return {
    key,
    modifiers
  }
}

export function formatRuntimeActionShortcut(
  actionShortcut: ExtensionActionNode["shortcut"],
  platform: ShortcutPlatform = resolveShortcutPlatform(window.electron.process.platform)
): string | null {
  const shortcut = toLauncherActionShortcut(actionShortcut)
  return shortcut ? formatShortcutChord(shortcut, platform) : null
}
