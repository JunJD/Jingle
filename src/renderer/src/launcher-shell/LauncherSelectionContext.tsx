import {
  createContext,
  use,
  useCallback,
  useEffect,
  useSyncExternalStore,
  type ReactNode
} from "react"
import type { LauncherSelectionContextSnapshot } from "@shared/launcher-selection"

interface LauncherSelectionStoreState {
  clearContext: (id?: string) => Promise<void>
  context: LauncherSelectionContextSnapshot
  refreshContext: (
    deadlineAt?: number,
    isCurrent?: () => boolean
  ) => Promise<LauncherSelectionContextSnapshot>
}

export type LauncherSelectionState = LauncherSelectionStoreState

interface LauncherSelectionStoreData {
  context: LauncherSelectionContextSnapshot
}

const launcherSelectionProviderContext = createContext(false)

function createLauncherSelectionStore() {
  const listeners = new Set<() => void>()
  let data: LauncherSelectionStoreData = {
    context: null
  }
  let contextRequestGeneration = 0
  let snapshot: LauncherSelectionStoreState

  const emit = (): void => {
    snapshot = createStateSnapshot()
    listeners.forEach((listener) => listener())
  }

  const setContext = (context: LauncherSelectionContextSnapshot): void => {
    if (Object.is(data.context, context)) {
      return
    }

    data = {
      context
    }
    emit()
  }

  const actions = {
    clearContext: async (id?: string): Promise<void> => {
      const generation = ++contextRequestGeneration
      await window.api.launcher.clearSelectionContext(id)
      if (generation !== contextRequestGeneration) {
        return
      }

      setContext(null)
    },
    refreshContext: async (
      deadlineAt = Number.POSITIVE_INFINITY,
      isCurrent: () => boolean = () => true
    ): Promise<LauncherSelectionContextSnapshot> => {
      const generation = ++contextRequestGeneration
      const context = await window.api.launcher.getSelectionContext()
      if (generation === contextRequestGeneration && Date.now() < deadlineAt && isCurrent()) {
        setContext(context)
      }
      return context
    }
  }

  const createStateSnapshot = (): LauncherSelectionStoreState => ({
    ...actions,
    context: data.context
  })

  snapshot = createStateSnapshot()

  return {
    getState: (): LauncherSelectionStoreState => snapshot,
    invalidatePendingContextRefresh: (): void => {
      contextRequestGeneration += 1
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

const launcherSelectionStore = createLauncherSelectionStore()

export function LauncherSelectionProvider(props: { children: ReactNode }): React.JSX.Element {
  const { children } = props

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      void launcherSelectionStore
        .getState()
        .refreshContext()
        .catch((error: unknown) => {
          console.error("[launcher] failed to refresh selection context", error)
        })
    })
    const cleanupShown = window.api.launcher.onShown(async (event) => {
      await launcherSelectionStore.getState().refreshContext(event.deadlineAt, event.isCurrent)
    })
    const cleanupUpdated = window.api.launcher.onSelectionContextUpdated(() => {
      void launcherSelectionStore
        .getState()
        .refreshContext()
        .catch((error: unknown) => {
          console.error("[launcher] failed to refresh selection context", error)
        })
    })

    return () => {
      launcherSelectionStore.invalidatePendingContextRefresh()
      window.cancelAnimationFrame(frameId)
      cleanupShown()
      cleanupUpdated()
    }
  }, [])

  return (
    <launcherSelectionProviderContext.Provider value>
      {children}
    </launcherSelectionProviderContext.Provider>
  )
}

export function useLauncherSelection(): LauncherSelectionStoreState
export function useLauncherSelection<T>(selector: (state: LauncherSelectionStoreState) => T): T
export function useLauncherSelection<T>(
  selector?: (state: LauncherSelectionStoreState) => T
): LauncherSelectionStoreState | T {
  const mounted = use(launcherSelectionProviderContext)
  const selectedState = useSyncExternalStore(
    launcherSelectionStore.subscribe,
    () => {
      const state = launcherSelectionStore.getState()
      return selector ? selector(state) : state
    },
    () => {
      const state = launcherSelectionStore.getState()
      return selector ? selector(state) : state
    }
  )

  if (!mounted) {
    throw new Error("useLauncherSelection must be used within LauncherSelectionProvider")
  }

  return selectedState as LauncherSelectionStoreState | T
}

export function useRefreshLauncherSelectionContext(): () => Promise<LauncherSelectionContextSnapshot> {
  return useCallback(() => launcherSelectionStore.getState().refreshContext(), [])
}
