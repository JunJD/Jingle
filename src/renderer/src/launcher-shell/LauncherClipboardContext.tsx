/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react"
import { useClipboardState } from "./hooks/useClipboardState"

export type LauncherClipboardState = ReturnType<typeof useClipboardState>

export const LauncherClipboardContext = createContext<LauncherClipboardState | null>(null)

export function LauncherClipboardProvider(props: { children: ReactNode }): React.JSX.Element {
  const { children } = props
  const value = useClipboardState()

  return (
    <LauncherClipboardContext.Provider value={value}>{children}</LauncherClipboardContext.Provider>
  )
}

export function useLauncherClipboard(): LauncherClipboardState {
  const context = useContext(LauncherClipboardContext)

  if (!context) {
    throw new Error("useLauncherClipboard must be used within LauncherClipboardProvider")
  }

  return context
}
