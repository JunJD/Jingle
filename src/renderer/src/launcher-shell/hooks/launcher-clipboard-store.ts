import { useSyncExternalStore } from "react"
import {
  createLauncherClipboardStore,
  type LauncherClipboardStoreState
} from "./launcher-clipboard-store-core"

export const launcherClipboardStore = createLauncherClipboardStore()
export type { LauncherClipboardStoreState } from "./launcher-clipboard-store-core"

export function useLauncherClipboardStore(): LauncherClipboardStoreState
export function useLauncherClipboardStore<T>(
  selector: (state: LauncherClipboardStoreState) => T
): T
export function useLauncherClipboardStore<T>(
  selector?: (state: LauncherClipboardStoreState) => T
): LauncherClipboardStoreState | T {
  return useSyncExternalStore(
    launcherClipboardStore.subscribe,
    () => {
      const state = launcherClipboardStore.getState()
      return selector ? selector(state) : state
    },
    () => {
      const state = launcherClipboardStore.getState()
      return selector ? selector(state) : state
    }
  )
}
