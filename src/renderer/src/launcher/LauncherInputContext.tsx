/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { useLauncherClipboard } from "./LauncherClipboardContext"

interface LauncherInputContextValue {
  query: string
  setQuery: (value: string) => void
}

const LauncherInputContext = createContext<LauncherInputContextValue | null>(null)

export function LauncherInputProvider(props: { children: ReactNode }): React.JSX.Element {
  const { children } = props
  const clipboard = useLauncherClipboard()
  const { context, isTextAutofillConsumed, markTextAutofillConsumed } = clipboard
  const [query, setQueryState] = useState("")

  const setQuery = useCallback((value: string): void => {
    setQueryState(value)
  }, [])

  useEffect(() => {
    if (context.kind !== "text" || isTextAutofillConsumed || query.trim().length > 0) {
      return
    }

    const text = context.text
    const frameId = window.requestAnimationFrame(() => {
      setQuery(text)
      markTextAutofillConsumed()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [context, isTextAutofillConsumed, markTextAutofillConsumed, query, setQuery])

  return (
    <LauncherInputContext.Provider
      value={{
        query,
        setQuery
      }}
    >
      {children}
    </LauncherInputContext.Provider>
  )
}

export function useLauncherInput(): LauncherInputContextValue {
  const context = useContext(LauncherInputContext)

  if (!context) {
    throw new Error("useLauncherInput must be used within LauncherInputProvider")
  }

  return context
}
