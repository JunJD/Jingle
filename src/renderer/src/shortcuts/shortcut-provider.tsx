import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react"
import type { ResolvedShortcutBinding } from "@shared/shortcuts/settings"
import type { ShortcutScope } from "@shared/shortcuts/model"
import {
  getShortcutBootstrapState,
  loadResolvedShortcutBindings,
  resolveRendererShortcutBindings
} from "./binding-registry"
import {
  shortcutSystemContext,
  type ShortcutRuntimeContext,
  type ShortcutSystemContextValue
} from "./shortcut-context"
import { createShortcutManager, type ShortcutManagerController } from "./shortcut-manager"

interface ShortcutScopeLayer {
  id: number
  scopes: readonly ShortcutScope[]
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

function createInitialRuntimeContext(
  windowKind: ShortcutRuntimeContext["windowKind"]
): ShortcutRuntimeContext {
  return {
    activeScopes: getDefaultScopes(windowKind),
    isComposing: false,
    textInputFocus: false,
    windowKind
  }
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

export function ShortcutProvider(props: {
  children: ReactNode
  windowKind: ShortcutRuntimeContext["windowKind"]
}): React.JSX.Element {
  const { children, windowKind } = props
  const [bootstrapState] = useState(() => getShortcutBootstrapState())
  const [bindings, setBindings] = useState<ResolvedShortcutBinding[]>(bootstrapState.bindings)
  const [isComposing, setIsComposing] = useState(false)
  const [settings, setSettings] = useState(bootstrapState.settings)
  const [scopeLayers, setScopeLayers] = useState<ShortcutScopeLayer[]>([])
  const [textInputFocus, setTextInputFocusState] = useState(false)
  const [manager] = useState<ShortcutManagerController>(() =>
    createShortcutManager(createInitialRuntimeContext(windowKind))
  )
  const loadRevisionRef = useRef(0)
  const nextScopeLayerIdRef = useRef(0)
  const runtimeContext = useMemo<ShortcutRuntimeContext>(
    () => ({
      activeScopes: resolveActiveScopes(windowKind, scopeLayers),
      isComposing,
      textInputFocus,
      windowKind
    }),
    [isComposing, scopeLayers, textInputFocus, windowKind]
  )

  const refreshBindings = useCallback(async (): Promise<void> => {
    const loadRevision = loadRevisionRef.current + 1
    loadRevisionRef.current = loadRevision
    const nextState = await loadResolvedShortcutBindings()
    if (loadRevisionRef.current !== loadRevision) {
      return
    }

    setBindings(nextState.bindings)
    setSettings(nextState.settings)
  }, [])
  const registerHandler = useCallback<ShortcutSystemContextValue["registerHandler"]>(
    (commandId, handler) => manager.registerHandler(commandId, handler),
    [manager]
  )
  const registerScopeLayer = useCallback<ShortcutSystemContextValue["registerScopeLayer"]>(
    (scopes) => {
      const id = nextScopeLayerIdRef.current + 1
      nextScopeLayerIdRef.current = id

      setScopeLayers((current) => [...current, { id, scopes }])

      return () => {
        setScopeLayers((current) => current.filter((layer) => layer.id !== id))
      }
    },
    []
  )
  const setComposing = useCallback<ShortcutSystemContextValue["setComposing"]>((isComposing) => {
    setIsComposing((current) => (current === isComposing ? current : isComposing))
  }, [])
  const setTextInputFocus = useCallback<ShortcutSystemContextValue["setTextInputFocus"]>(
    (textInputFocus) => {
      setTextInputFocusState((current) => (current === textInputFocus ? current : textInputFocus))
    },
    []
  )

  useEffect(() => {
    const unsubscribe = window.api.shortcuts.onSettingsChanged((nextSettings) => {
      loadRevisionRef.current += 1
      setBindings(resolveRendererShortcutBindings(nextSettings))
      setSettings(nextSettings)
    })

    return unsubscribe
  }, [])

  useLayoutEffect(() => {
    manager.setBindings(bindings)
  }, [bindings, manager])

  useLayoutEffect(() => {
    manager.setRuntimeContext(runtimeContext)
  }, [manager, runtimeContext])

  useLayoutEffect(() => {
    manager.start()

    return () => {
      manager.dispose()
    }
  }, [manager])

  const value = useMemo<ShortcutSystemContextValue>(
    () => ({
      bindings,
      refreshBindings,
      registerHandler,
      registerScopeLayer,
      runtimeContext,
      setComposing,
      setTextInputFocus,
      settings
    }),
    [
      bindings,
      refreshBindings,
      registerHandler,
      registerScopeLayer,
      runtimeContext,
      setComposing,
      setTextInputFocus,
      settings
    ]
  )

  return <shortcutSystemContext.Provider value={value}>{children}</shortcutSystemContext.Provider>
}
