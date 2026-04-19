import type { ShortcutScope } from "../../../shared/shortcuts/model"
import type { ResolvedShortcutBinding, ShortcutSettings } from "../../../shared/shortcuts/settings"

export interface ShortcutRuntimeContext {
  activeScopes: readonly ShortcutScope[]
  isComposing: boolean
  textInputFocus: boolean
  windowKind: "launcher" | "main" | "settings"
}

export interface ShortcutSystemState {
  bindings: readonly ResolvedShortcutBinding[]
  runtimeContext: ShortcutRuntimeContext
  settings: ShortcutSettings
}

interface ShortcutScopeLayer {
  id: number
  scopes: readonly ShortcutScope[]
}

interface ShortcutSystemData {
  bindings: readonly ResolvedShortcutBinding[]
  isComposing: boolean
  scopeLayers: readonly ShortcutScopeLayer[]
  settings: ShortcutSettings
  textInputFocus: boolean
}

export interface ShortcutSystemStore {
  applySettings: (settings: ShortcutSettings) => void
  getState: () => ShortcutSystemState
  refreshBindings: () => Promise<void>
  registerScopeLayer: (scopes: readonly ShortcutScope[]) => () => void
  setComposing: (value: boolean) => void
  setTextInputFocus: (value: boolean) => void
  subscribe: (listener: () => void) => () => void
}

export interface CreateShortcutSystemStoreOptions {
  bootstrapState: {
    bindings: ResolvedShortcutBinding[]
    settings: ShortcutSettings
  }
  loadResolvedBindings: () => Promise<{
    bindings: ResolvedShortcutBinding[]
    settings: ShortcutSettings
  }>
  resolveBindings: (settings: ShortcutSettings) => ResolvedShortcutBinding[]
  windowKind: ShortcutRuntimeContext["windowKind"]
}

function getDefaultScopes(
  windowKind: ShortcutRuntimeContext["windowKind"]
): readonly ShortcutScope[] {
  if (windowKind === "launcher") {
    return ["launcher", "window"]
  }

  if (windowKind === "settings") {
    return ["settings", "window"]
  }

  return ["window"]
}

function resolveActiveScopes(
  windowKind: ShortcutRuntimeContext["windowKind"],
  layers: readonly ShortcutScopeLayer[]
): readonly ShortcutScope[] {
  const scopes: ShortcutScope[] = []
  const seen = new Set<ShortcutScope>()

  const appendScopes = (nextScopes: readonly ShortcutScope[]) => {
    for (const scope of nextScopes) {
      if (seen.has(scope)) {
        continue
      }

      seen.add(scope)
      scopes.push(scope)
    }
  }

  for (const layer of [...layers].reverse()) {
    appendScopes(layer.scopes)
  }

  appendScopes(getDefaultScopes(windowKind))
  return scopes
}

export function createShortcutSystemStore(
  options: CreateShortcutSystemStoreOptions
): ShortcutSystemStore {
  const { bootstrapState, loadResolvedBindings, resolveBindings, windowKind } = options
  const listeners = new Set<() => void>()
  let loadRevision = 0
  let nextScopeLayerId = 0
  let data: ShortcutSystemData = {
    bindings: bootstrapState.bindings,
    isComposing: false,
    scopeLayers: [],
    settings: bootstrapState.settings,
    textInputFocus: false
  }
  let snapshot: ShortcutSystemState

  const emit = (): void => {
    snapshot = {
      bindings: data.bindings,
      runtimeContext: {
        activeScopes: resolveActiveScopes(windowKind, data.scopeLayers),
        isComposing: data.isComposing,
        textInputFocus: data.textInputFocus,
        windowKind
      },
      settings: data.settings
    }
    listeners.forEach((listener) => listener())
  }

  const setData = (
    update:
      | Partial<ShortcutSystemData>
      | ((current: ShortcutSystemData) => Partial<ShortcutSystemData>)
  ): void => {
    const nextPartial = typeof update === "function" ? update(data) : update
    let changed = false
    for (const key of Object.keys(nextPartial) as (keyof ShortcutSystemData)[]) {
      if (!Object.is(data[key], nextPartial[key])) {
        changed = true
        break
      }
    }

    if (!changed) {
      return
    }

    data = {
      ...data,
      ...nextPartial
    }
    emit()
  }

  snapshot = {
    bindings: data.bindings,
    runtimeContext: {
      activeScopes: resolveActiveScopes(windowKind, data.scopeLayers),
      isComposing: data.isComposing,
      textInputFocus: data.textInputFocus,
      windowKind
    },
    settings: data.settings
  }

  return {
    applySettings: (settings): void => {
      loadRevision += 1
      setData({
        bindings: resolveBindings(settings),
        settings
      })
    },
    getState: (): ShortcutSystemState => snapshot,
    refreshBindings: async (): Promise<void> => {
      const nextRevision = loadRevision + 1
      loadRevision = nextRevision
      const nextState = await loadResolvedBindings()
      if (loadRevision !== nextRevision) {
        return
      }

      setData({
        bindings: nextState.bindings,
        settings: nextState.settings
      })
    },
    registerScopeLayer: (scopes): (() => void) => {
      const id = nextScopeLayerId + 1
      nextScopeLayerId = id
      setData((current) => ({
        scopeLayers: [...current.scopeLayers, { id, scopes }]
      }))

      return () => {
        setData((current) => ({
          scopeLayers: current.scopeLayers.filter((layer) => layer.id !== id)
        }))
      }
    },
    setComposing: (value): void => {
      setData((current) => (current.isComposing === value ? {} : { isComposing: value }))
    },
    setTextInputFocus: (value): void => {
      setData((current) => (current.textInputFocus === value ? {} : { textInputFocus: value }))
    },
    subscribe: (listener): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
