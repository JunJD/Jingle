import { useSyncExternalStore } from "react"
import {
  createLauncherSearchPageStore,
  type LauncherSearchPageStoreState
} from "./launcher-search-page-store-core"

export const launcherSearchPageStore = createLauncherSearchPageStore()

export function useLauncherSearchPageStore(): LauncherSearchPageStoreState
export function useLauncherSearchPageStore<T>(
  selector: (state: LauncherSearchPageStoreState) => T
): T
export function useLauncherSearchPageStore<T>(
  selector?: (state: LauncherSearchPageStoreState) => T
): LauncherSearchPageStoreState | T {
  return useSyncExternalStore(
    launcherSearchPageStore.subscribe,
    () => {
      const state = launcherSearchPageStore.getState()
      return selector ? selector(state) : state
    },
    () => {
      const state = launcherSearchPageStore.getState()
      return selector ? selector(state) : state
    }
  )
}
