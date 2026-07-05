import { useSyncExternalStore } from "react"
import { createLauncherRouterStore, type LauncherRouterState } from "./launcher-router-store-core"

export const launcherRouterStore = createLauncherRouterStore()

export function useLauncherRouter(): LauncherRouterState
export function useLauncherRouter<T>(selector: (state: LauncherRouterState) => T): T
export function useLauncherRouter<T>(
  selector?: (state: LauncherRouterState) => T
): LauncherRouterState | T {
  return useSyncExternalStore(
    launcherRouterStore.subscribe,
    () => {
      const state = launcherRouterStore.getState()
      return selector ? selector(state) : state
    },
    () => {
      const state = launcherRouterStore.getState()
      return selector ? selector(state) : state
    }
  )
}
