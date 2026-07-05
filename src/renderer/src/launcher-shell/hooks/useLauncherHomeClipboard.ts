import { useCallback } from "react"
import type { ClipboardContext } from "@shared/clipboard"
import { useLauncherClipboard } from "../LauncherClipboardContext"

export function useLauncherHomeClipboard(params: {
  requestSelection: () => void
  setQuery: (value: string) => void
}): {
  acceptCandidate: () => void
  candidateContext: ClipboardContext
  clearContext: () => void
} {
  const { requestSelection, setQuery } = params
  const acceptContext = useLauncherClipboard((state) => state.acceptContext)
  const candidateContext = useLauncherClipboard((state) => state.candidateContext)
  const clearContext = useLauncherClipboard((state) => state.clearContext)

  const acceptCandidate = useCallback((): void => {
    if (candidateContext.kind === "text") {
      const autofillText = candidateContext.text
      clearContext()
      window.requestAnimationFrame(() => {
        setQuery(autofillText)
        requestSelection()
      })
      return
    }

    acceptContext()
  }, [acceptContext, candidateContext, clearContext, requestSelection, setQuery])

  return {
    acceptCandidate,
    candidateContext,
    clearContext
  }
}
