import { createContext, useContext, useLayoutEffect, useSyncExternalStore } from "react"
import type { ShortcutScope } from "@shared/shortcuts/model"
import type { ResolvedShortcutBinding, ShortcutSettings } from "@shared/shortcuts/settings"
import type {
  ShortcutRuntimeContext,
  ShortcutSystemState,
  ShortcutSystemStore
} from "./shortcut-system-store"

export interface ShortcutSystemController extends Pick<
  ShortcutSystemStore,
  | "getState"
  | "refreshBindings"
  | "registerScopeLayer"
  | "setComposing"
  | "setTextInputFocus"
  | "subscribe"
> {
  registerHandler: (commandId: string, handler: (event: KeyboardEvent) => void) => () => void
}

export const shortcutSystemContext = createContext<ShortcutSystemController | null>(null)

export function useShortcutSystem(): ShortcutSystemController {
  const context = useContext(shortcutSystemContext)
  if (!context) {
    throw new Error("useShortcutSystem must be used within ShortcutProvider")
  }

  return context
}

function useShortcutSystemValue<T>(selector: (state: ShortcutSystemState) => T): T {
  const system = useShortcutSystem()

  return useSyncExternalStore(
    system.subscribe,
    () => selector(system.getState()),
    () => selector(system.getState())
  )
}

export function useShortcutBindings(): readonly ResolvedShortcutBinding[] {
  return useShortcutSystemValue((state) => state.bindings)
}

export function useShortcutBinding(
  commandId: string,
  scope?: ResolvedShortcutBinding["scope"]
): ResolvedShortcutBinding | null {
  return useShortcutSystemValue((state) => {
    return (
      state.bindings.find(
        (binding) =>
          binding.commandId === commandId && (scope === undefined || binding.scope === scope)
      ) ?? null
    )
  })
}

export function useShortcutSettings(): ShortcutSettings {
  return useShortcutSystemValue((state) => state.settings)
}

export function useShortcutRuntimeContext(): ShortcutRuntimeContext {
  return useShortcutSystemValue((state) => state.runtimeContext)
}

export function useShortcutCommandHandler(
  commandId: string,
  handler: (event: KeyboardEvent) => void
): void {
  const { registerHandler } = useShortcutSystem()

  useLayoutEffect(() => registerHandler(commandId, handler), [commandId, handler, registerHandler])
}

export function useShortcutScopeLayer(scopes: readonly ShortcutScope[]): void {
  const { registerScopeLayer } = useShortcutSystem()

  useLayoutEffect(() => registerScopeLayer(scopes), [registerScopeLayer, scopes])
}
