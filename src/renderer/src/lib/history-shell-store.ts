import { useSyncExternalStore } from "react"
import { createHistoryShellStore, type HistoryShellState } from "./history-shell-store-core"

export const historyShellStore = createHistoryShellStore(window.api)

export function useHistoryShellStore(): HistoryShellState
export function useHistoryShellStore<T>(selector: (state: HistoryShellState) => T): T
export function useHistoryShellStore<T>(
  selector?: (state: HistoryShellState) => T
): HistoryShellState | T {
  return useSyncExternalStore(
    historyShellStore.subscribe,
    () => {
      const state = historyShellStore.getState()
      return selector ? selector(state) : state
    },
    () => {
      const state = historyShellStore.getState()
      return selector ? selector(state) : state
    }
  )
}
