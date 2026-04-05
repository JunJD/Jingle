import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { DEFAULT_SHORTCUT_SETTINGS, type ResolvedShortcutBinding } from "@shared/shortcuts/settings"
import type { ShortcutScope } from "@shared/shortcuts/model"
import { loadResolvedShortcutBindings, resolveRendererShortcutBindings } from "./binding-registry"
import {
  shortcutSystemContext,
  type ShortcutRuntimeContext,
  type ShortcutSystemContextValue
} from "./shortcut-context"
import { createShortcutManager, type ShortcutManagerController } from "./shortcut-manager"

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

function areShortcutScopesEqual(
  left: readonly ShortcutScope[],
  right: readonly ShortcutScope[]
): boolean {
  return left.length === right.length && left.every((scope, index) => scope === right[index])
}

export function ShortcutProvider(props: {
  children: ReactNode
  windowKind: ShortcutRuntimeContext["windowKind"]
}): React.JSX.Element {
  const { children, windowKind } = props
  const [bindings, setBindings] = useState<ResolvedShortcutBinding[]>([])
  const [settings, setSettings] = useState(DEFAULT_SHORTCUT_SETTINGS)
  const [runtimeContext, setRuntimeContext] = useState<ShortcutRuntimeContext>(() =>
    createInitialRuntimeContext(windowKind)
  )
  const [manager] = useState<ShortcutManagerController>(() =>
    createShortcutManager(createInitialRuntimeContext(windowKind))
  )
  const loadRevisionRef = useRef(0)

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
  const setActiveScopes = useCallback<ShortcutSystemContextValue["setActiveScopes"]>(
    (activeScopes) => {
      setRuntimeContext((current) => {
        if (areShortcutScopesEqual(current.activeScopes, activeScopes)) {
          return current
        }

        return {
          ...current,
          activeScopes
        }
      })
    },
    []
  )
  const setComposing = useCallback<ShortcutSystemContextValue["setComposing"]>((isComposing) => {
    setRuntimeContext((current) => {
      if (current.isComposing === isComposing) {
        return current
      }

      return {
        ...current,
        isComposing
      }
    })
  }, [])
  const setTextInputFocus = useCallback<ShortcutSystemContextValue["setTextInputFocus"]>(
    (textInputFocus) => {
      setRuntimeContext((current) => {
        if (current.textInputFocus === textInputFocus) {
          return current
        }

        return {
          ...current,
          textInputFocus
        }
      })
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

  useEffect(() => {
    const loadRevision = loadRevisionRef.current + 1
    loadRevisionRef.current = loadRevision

    void loadResolvedShortcutBindings().then((nextState) => {
      if (loadRevisionRef.current !== loadRevision) {
        return
      }

      setBindings(nextState.bindings)
      setSettings(nextState.settings)
    })

    return () => {
      loadRevisionRef.current += 1
    }
  }, [])

  useEffect(() => {
    manager.setBindings(bindings)
  }, [bindings, manager])

  useEffect(() => {
    manager.setRuntimeContext(runtimeContext)
  }, [manager, runtimeContext])

  useEffect(() => {
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
      runtimeContext,
      setActiveScopes,
      setComposing,
      setTextInputFocus,
      settings
    }),
    [
      bindings,
      refreshBindings,
      registerHandler,
      runtimeContext,
      setActiveScopes,
      setComposing,
      setTextInputFocus,
      settings
    ]
  )

  return <shortcutSystemContext.Provider value={value}>{children}</shortcutSystemContext.Provider>
}
