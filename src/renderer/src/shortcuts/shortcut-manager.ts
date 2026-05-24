import type { ShortcutModifier, ShortcutScope } from "@shared/shortcuts/model"
import type { ResolvedShortcutBinding } from "@shared/shortcuts/settings"
import type { ShortcutRuntimeContext } from "./shortcut-system-store"

interface ShortcutManagerState {
  bindings: readonly ResolvedShortcutBinding[]
  handlers: Map<string, (event: KeyboardEvent) => void>
  runtimeContext: ShortcutRuntimeContext
}

const MODIFIER_FLAGS: Record<
  ShortcutModifier,
  keyof Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">
> = {
  alt: "altKey",
  ctrl: "ctrlKey",
  meta: "metaKey",
  shift: "shiftKey"
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.isContentEditable
  )
}

function getScopePriority(scope: ShortcutScope, activeScopes: readonly ShortcutScope[]): number {
  const activeScopeIndex = activeScopes.indexOf(scope)
  if (activeScopeIndex >= 0) {
    return activeScopeIndex
  }

  if (scope === "window") {
    return activeScopes.length
  }

  return Number.POSITIVE_INFINITY
}

function matchesShortcutKey(binding: ResolvedShortcutBinding, event: KeyboardEvent): boolean {
  if (binding.chord.code) {
    return event.code === binding.chord.code
  }

  if (binding.chord.key.length === 1) {
    return event.key.toLowerCase() === binding.chord.key.toLowerCase()
  }

  return event.key === binding.chord.key
}

function matchesShortcutBinding(binding: ResolvedShortcutBinding, event: KeyboardEvent): boolean {
  const requiredModifiers = new Set(binding.chord.modifiers)

  for (const modifier of Object.keys(MODIFIER_FLAGS) as ShortcutModifier[]) {
    const isPressed = event[MODIFIER_FLAGS[modifier]]
    if (isPressed !== requiredModifiers.has(modifier)) {
      return false
    }
  }

  if (binding.chord.code && event.code !== binding.chord.code) {
    return false
  }

  return matchesShortcutKey(binding, event)
}

function findMatchingBinding(
  state: ShortcutManagerState,
  event: KeyboardEvent
): ResolvedShortcutBinding | null {
  const isInputEvent =
    state.runtimeContext.textInputFocus || isTextInputTarget(event.target) || event.isComposing

  if (state.runtimeContext.isComposing || event.isComposing) {
    return null
  }

  return (
    state.bindings
      .filter((binding) => binding.scope !== "global")
      .filter((binding) => state.handlers.has(binding.commandId))
      .filter(
        (binding) =>
          binding.scope === "window" || state.runtimeContext.activeScopes.includes(binding.scope)
      )
      .filter((binding) => !isInputEvent || binding.allowInTextInput === true)
      .filter((binding) => matchesShortcutBinding(binding, event))
      .sort(
        (left, right) =>
          getScopePriority(left.scope, state.runtimeContext.activeScopes) -
          getScopePriority(right.scope, state.runtimeContext.activeScopes)
      )[0] ?? null
  )
}

export interface ShortcutManagerController {
  dispose: () => void
  registerHandler: (commandId: string, handler: (event: KeyboardEvent) => void) => () => void
  start: () => void
  setBindings: (bindings: readonly ResolvedShortcutBinding[]) => void
  setRuntimeContext: (runtimeContext: ShortcutRuntimeContext) => void
}

export function createShortcutManager(
  initialRuntimeContext: ShortcutRuntimeContext
): ShortcutManagerController {
  const state: ShortcutManagerState = {
    bindings: [],
    handlers: new Map(),
    runtimeContext: initialRuntimeContext
  }
  let started = false

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) {
      return
    }

    const binding = findMatchingBinding(state, event)
    if (!binding) {
      return
    }

    if (binding.preventDefault) {
      event.preventDefault()
    }

    state.handlers.get(binding.commandId)?.(event)
  }

  return {
    dispose: () => {
      state.handlers.clear()
      if (started) {
        window.removeEventListener("keydown", onKeyDown)
        started = false
      }
    },
    registerHandler: (commandId, handler) => {
      state.handlers.set(commandId, handler)

      return () => {
        const currentHandler = state.handlers.get(commandId)
        if (currentHandler === handler) {
          state.handlers.delete(commandId)
        }
      }
    },
    start: () => {
      if (started) {
        return
      }

      window.addEventListener("keydown", onKeyDown)
      started = true
    },
    setBindings: (bindings) => {
      state.bindings = bindings
    },
    setRuntimeContext: (runtimeContext) => {
      state.runtimeContext = runtimeContext
    }
  }
}
