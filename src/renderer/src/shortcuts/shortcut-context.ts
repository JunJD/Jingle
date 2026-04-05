import { createContext, useContext, useLayoutEffect } from "react"
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
  registerScopeLayer: (scopes: readonly ShortcutScope[]) => () => void
  runtimeContext: ShortcutRuntimeContext
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

export function useShortcutCommandHandler(
  commandId: string,
  handler: (event: KeyboardEvent) => void
): void {
  const { registerHandler } = useShortcutSystem()

  useLayoutEffect(
    () => registerHandler(commandId, handler),
    [commandId, handler, registerHandler]
  )
}

export function useShortcutScopeLayer(scopes: readonly ShortcutScope[]): void {
  const { registerScopeLayer } = useShortcutSystem()

  useLayoutEffect(() => registerScopeLayer(scopes), [registerScopeLayer, scopes])
}
