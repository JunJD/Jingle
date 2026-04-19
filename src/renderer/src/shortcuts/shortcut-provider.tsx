import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react"
import { loadResolvedShortcutBindings, resolveRendererShortcutBindings } from "./binding-registry"
import { shortcutSystemContext, type ShortcutSystemController } from "./shortcut-context"
import { createShortcutManager, type ShortcutManagerController } from "./shortcut-manager"
import { createShortcutSystemStore, type ShortcutRuntimeContext } from "./shortcut-system-store"
import { getShortcutBootstrapState } from "./binding-registry"

export function ShortcutProvider(props: {
  children: ReactNode
  windowKind: ShortcutRuntimeContext["windowKind"]
}): React.JSX.Element {
  const { children, windowKind } = props
  const [store] = useState(() =>
    createShortcutSystemStore({
      bootstrapState: getShortcutBootstrapState(),
      loadResolvedBindings: loadResolvedShortcutBindings,
      resolveBindings: resolveRendererShortcutBindings,
      windowKind
    })
  )
  const [manager] = useState<ShortcutManagerController>(() =>
    createShortcutManager(store.getState().runtimeContext)
  )

  useEffect(() => {
    const unsubscribe = window.api.shortcuts.onSettingsChanged((nextSettings) => {
      store.applySettings(nextSettings)
    })

    return unsubscribe
  }, [store])

  useLayoutEffect(() => {
    const syncManager = (): void => {
      const state = store.getState()
      manager.setBindings(state.bindings)
      manager.setRuntimeContext(state.runtimeContext)
    }

    syncManager()
    return store.subscribe(syncManager)
  }, [manager, store])

  useLayoutEffect(() => {
    manager.start()

    return () => {
      manager.dispose()
    }
  }, [manager])

  const value = useMemo<ShortcutSystemController>(
    () => ({
      getState: store.getState,
      refreshBindings: store.refreshBindings,
      registerHandler: manager.registerHandler,
      registerScopeLayer: store.registerScopeLayer,
      setComposing: store.setComposing,
      setTextInputFocus: store.setTextInputFocus,
      subscribe: store.subscribe
    }),
    [manager.registerHandler, store]
  )

  return <shortcutSystemContext.Provider value={value}>{children}</shortcutSystemContext.Provider>
}
