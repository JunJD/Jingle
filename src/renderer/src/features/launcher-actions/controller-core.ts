import type { ShortcutChord, ShortcutModifier } from "@shared/shortcuts/model"
import type { LauncherActionDescriptor } from "./model"

interface LauncherActionShortcutEvent {
  altKey: boolean
  code?: string
  ctrlKey: boolean
  key: string
  metaKey: boolean
  shiftKey: boolean
}

const SHORTCUT_MODIFIER_FLAGS: Record<
  ShortcutModifier,
  keyof Pick<LauncherActionShortcutEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">
> = {
  alt: "altKey",
  ctrl: "ctrlKey",
  meta: "metaKey",
  shift: "shiftKey"
}

export function resolveActionPanelShortcutOpenState(
  currentOpen: boolean,
  canOpenActions: boolean
): boolean {
  if (!canOpenActions) {
    return false
  }

  return !currentOpen
}

export function matchesLauncherActionShortcut(
  shortcut: ShortcutChord,
  event: LauncherActionShortcutEvent
): boolean {
  const requiredModifiers = new Set(shortcut.modifiers)

  for (const modifier of Object.keys(SHORTCUT_MODIFIER_FLAGS) as ShortcutModifier[]) {
    if (event[SHORTCUT_MODIFIER_FLAGS[modifier]] !== requiredModifiers.has(modifier)) {
      return false
    }
  }

  if (shortcut.code) {
    return event.code === shortcut.code
  }

  if (shortcut.key.length === 1) {
    return event.key.toLowerCase() === shortcut.key.toLowerCase()
  }

  return event.key.toLowerCase() === shortcut.key.toLowerCase()
}

export function resolveLauncherActionShortcutMatch(
  actions: readonly LauncherActionDescriptor[],
  event: LauncherActionShortcutEvent
): LauncherActionDescriptor | null {
  for (const action of actions) {
    const childMatch = action.children
      ? resolveLauncherActionShortcutMatch(action.children, event)
      : null
    if (childMatch) {
      return childMatch
    }

    if (
      !action.disabled &&
      (!action.children || action.children.length === 0) &&
      action.shortcutChord &&
      matchesLauncherActionShortcut(action.shortcutChord, event)
    ) {
      return action
    }
  }

  return null
}

export function findFirstExecutableLauncherAction(
  actions: readonly LauncherActionDescriptor[]
): LauncherActionDescriptor | null {
  for (const action of actions) {
    if (action.disabled) {
      continue
    }

    if (!action.children || action.children.length === 0) {
      return action
    }

    const childAction = findFirstExecutableLauncherAction(action.children)
    if (childAction) {
      return childAction
    }
  }

  return null
}

export function hasLauncherActionPanelEntries(
  actions: readonly LauncherActionDescriptor[]
): boolean {
  const enabledActions = actions.filter((action) => !action.disabled)
  return (
    enabledActions.length > 1 ||
    enabledActions.some((action) => (action.children ?? []).some((child) => !child.disabled))
  )
}
