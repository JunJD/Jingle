import { createContext, useContext } from "react"
import type { ShortcutScope } from "../../../shared/shortcuts/model"
import type { ResolvedShortcutBinding, ShortcutSettings } from "../../../shared/shortcuts/settings"

export interface ShortcutRuntimeContext {
  activeScopes: readonly ShortcutScope[]
  isComposing: boolean
  textInputFocus: boolean
  windowKind: "launcher" | "main" | "settings"
}

export interface ShortcutSystemContextValue {
  bindings: readonly ResolvedShortcutBinding[]
  refreshBindings: () => Promise<void>
  registerHandler: (commandId: string, handler: (event: KeyboardEvent) => void) => () => void
  runtimeContext: ShortcutRuntimeContext
  setActiveScopes: (scopes: readonly ShortcutScope[]) => void
  setComposing: (value: boolean) => void
  setTextInputFocus: (value: boolean) => void
  settings: ShortcutSettings
}

export const shortcutSystemContext = createContext<ShortcutSystemContextValue | null>(null)

export function useShortcutSystem(): ShortcutSystemContextValue {
  const context = useContext(shortcutSystemContext)
  if (!context) {
    throw new Error("useShortcutSystem must be used within ShortcutProvider")
  }

  return context
}

export function useShortcutBindings(): readonly ResolvedShortcutBinding[] {
  return useShortcutSystem().bindings
}

export function useShortcutRuntimeContext(): ShortcutRuntimeContext {
  return useShortcutSystem().runtimeContext
}
