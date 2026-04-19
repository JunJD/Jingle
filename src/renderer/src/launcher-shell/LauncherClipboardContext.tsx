/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react"
import {
  useLauncherClipboardStore,
  type LauncherClipboardStoreState
} from "./hooks/launcher-clipboard-store"
import { useLauncherClipboardRuntime } from "./hooks/useLauncherClipboardRuntime"

export type LauncherClipboardState = LauncherClipboardStoreState

const launcherClipboardProviderContext = createContext(false)

export function LauncherClipboardProvider(props: { children: ReactNode }): React.JSX.Element {
  const { children } = props

  useLauncherClipboardRuntime()

  return (
    <launcherClipboardProviderContext.Provider value>
      {children}
    </launcherClipboardProviderContext.Provider>
  )
}

export function useLauncherClipboard(): LauncherClipboardState
export function useLauncherClipboard<T>(selector: (state: LauncherClipboardState) => T): T
export function useLauncherClipboard<T>(
  selector?: (state: LauncherClipboardState) => T
): LauncherClipboardState | T {
  const mounted = useContext(launcherClipboardProviderContext)
  const resolvedSelector = (selector ??
    ((state: LauncherClipboardState) => state)) as (
    state: LauncherClipboardState
  ) => LauncherClipboardState | T
  const selectedState = useLauncherClipboardStore(resolvedSelector)

  if (!mounted) {
    throw new Error("useLauncherClipboard must be used within LauncherClipboardProvider")
  }

  return selectedState as LauncherClipboardState | T
}
