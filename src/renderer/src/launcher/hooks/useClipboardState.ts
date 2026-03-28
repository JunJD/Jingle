import { useCallback, useEffect, useMemo, useState } from "react"
import type { ClipboardContext } from "../../../../shared/clipboard"

const EMPTY_CLIPBOARD_CONTEXT: ClipboardContext = {
  kind: "none"
}

function getClipboardContextKey(context: ClipboardContext): string {
  switch (context.kind) {
    case "none":
      return "none"
    case "image":
      return `image:${context.image.width}x${context.image.height}:${context.image.previewDataUrl.length}:${context.image.previewDataUrl.slice(-48)}`
    case "text":
      return `text:${context.text}`
    case "files":
      return `files:${context.files.map((file) => file.path).join("|")}`
    default: {
      const exhaustiveContext: never = context
      return JSON.stringify(exhaustiveContext)
    }
  }
}

export function useClipboardState(): {
  clearContext: () => void
  context: ClipboardContext
  contextKey: string
  isTextAutofillConsumed: boolean
  markTextAutofillConsumed: () => void
} {
  const [rawContext, setRawContext] = useState<ClipboardContext>(EMPTY_CLIPBOARD_CONTEXT)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const [consumedTextKey, setConsumedTextKey] = useState<string | null>(null)

  const refreshContext = useCallback(async (): Promise<void> => {
    const nextContext = await window.api.launcher.getClipboardContext()
    setRawContext(nextContext)
    setDismissedKey(null)
    setConsumedTextKey(null)
  }, [])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      void refreshContext()
    })

    const cleanupShown = window.api.launcher.onShown(() => {
      void refreshContext()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      cleanupShown()
    }
  }, [refreshContext])

  const rawContextKey = useMemo(() => getClipboardContextKey(rawContext), [rawContext])
  const context = dismissedKey === rawContextKey ? EMPTY_CLIPBOARD_CONTEXT : rawContext

  return {
    clearContext: () => {
      setDismissedKey(rawContextKey)
    },
    context,
    contextKey: getClipboardContextKey(context),
    isTextAutofillConsumed: consumedTextKey === rawContextKey,
    markTextAutofillConsumed: () => {
      setConsumedTextKey(rawContextKey)
    }
  }
}
