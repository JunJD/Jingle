import { useEffect, useMemo } from "react"
import { deriveLauncherHomeClipboardState } from "../../../../shared/clipboard-derivations"
import { useLauncherClipboard } from "../LauncherClipboardContext"

export function useLauncherHomeClipboard(params: {
  query: string
  requestSelection: () => void
  setQuery: (value: string) => void
}): {
  clearContext: () => void
  previewContext: ReturnType<typeof deriveLauncherHomeClipboardState>["previewContext"]
} {
  const { query, requestSelection, setQuery } = params
  const { context, clearContext, isTextAutofillConsumed, markTextAutofillConsumed } =
    useLauncherClipboard()
  const derived = useMemo(() => deriveLauncherHomeClipboardState(context), [context])

  useEffect(() => {
    const autofillText = derived.autofillText
    if (!autofillText || isTextAutofillConsumed) {
      return
    }

    if (query.trim().length > 0) {
      markTextAutofillConsumed()
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      setQuery(autofillText)
      requestSelection()
      markTextAutofillConsumed()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [
    derived.autofillText,
    isTextAutofillConsumed,
    markTextAutofillConsumed,
    query,
    requestSelection,
    setQuery
  ])

  return {
    clearContext,
    previewContext: derived.previewContext
  }
}
