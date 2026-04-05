export type ShortcutPlatform = "darwin" | "win32" | "linux"

export type ShortcutModifier = "meta" | "ctrl" | "alt" | "shift"

export type ShortcutScope =
  | "global"
  | "window"
  | "launcher"
  | "launcher.home"
  | "launcher.ai"
  | "launcher.list"
  | "launcher.action-panel"
  | "settings"
  | "chat"

export type ShortcutCommandCategory = "global" | "launcher" | "app" | "extension" | "ai"

export interface ShortcutCommandDefinition {
  id: string
  title: string
  description?: string
  category: ShortcutCommandCategory
  configurable: boolean
}

export interface ShortcutChord {
  modifiers: ShortcutModifier[]
  key: string
  code?: string
}

export interface ShortcutBindingDefinition {
  commandId: string
  scope: ShortcutScope
  chord: ShortcutChord
  allowInTextInput?: boolean
  preventDefault?: boolean
  platform?: ShortcutPlatform
}

const MODIFIER_ORDER: Record<ShortcutModifier, number> = {
  ctrl: 0,
  alt: 1,
  shift: 2,
  meta: 3
}

export function resolveShortcutPlatform(value: string | undefined | null): ShortcutPlatform {
  return value === "darwin" || value === "win32" || value === "linux" ? value : "darwin"
}

export function normalizeShortcutChord(chord: ShortcutChord): ShortcutChord {
  const modifiers = Array.from(new Set(chord.modifiers)).sort(
    (left, right) => MODIFIER_ORDER[left] - MODIFIER_ORDER[right]
  )
  const key = chord.key.trim()
  const code = chord.code?.trim()

  return {
    modifiers,
    key,
    ...(code ? { code } : {})
  }
}

export function serializeShortcutChord(chord: ShortcutChord): string {
  const normalized = normalizeShortcutChord(chord)
  return [...normalized.modifiers, normalized.code ?? normalized.key].join("+")
}

export function areShortcutChordsEqual(left: ShortcutChord, right: ShortcutChord): boolean {
  return serializeShortcutChord(left) === serializeShortcutChord(right)
}
