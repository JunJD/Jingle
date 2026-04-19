import { useEffect, useMemo, useRef } from "react"
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
  const context = useLauncherClipboard((state) => state.context)
  const contextKey = useLauncherClipboard((state) => state.contextKey)
  const clearContext = useLauncherClipboard((state) => state.clearContext)
  const refreshSequence = useLauncherClipboard((state) => state.refreshSequence)
  const consumedAutofillTokenRef = useRef<string | null>(null)
  const derived = useMemo(() => deriveLauncherHomeClipboardState(context), [context])
  const autofillToken = derived.autofillText ? `${refreshSequence}:${contextKey}` : null

  useEffect(() => {
    const autofillText = derived.autofillText
    if (!autofillText || autofillToken === consumedAutofillTokenRef.current) {
      return
    }

    if (query.trim().length > 0) {
      consumedAutofillTokenRef.current = autofillToken
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      setQuery(autofillText)
      requestSelection()
      consumedAutofillTokenRef.current = autofillToken
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [derived.autofillText, autofillToken, query, requestSelection, setQuery])

  return {
    clearContext,
    previewContext: derived.previewContext
  }
}
