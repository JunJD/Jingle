import { createContext, use, useEffect, type ReactNode } from "react"
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
  useEffect(() => {
    window.api.launcher.setPresentationReady(true)
    return () => {
      window.api.launcher.setPresentationReady(false)
    }
  }, [])

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
  const mounted = use(launcherClipboardProviderContext)
  const resolvedSelector = (selector ?? ((state: LauncherClipboardState) => state)) as (
    state: LauncherClipboardState
  ) => LauncherClipboardState | T
  const selectedState = useLauncherClipboardStore(resolvedSelector)

  if (!mounted) {
    throw new Error("useLauncherClipboard must be used within LauncherClipboardProvider")
  }

  return selectedState as LauncherClipboardState | T
}
