import { useCallback, useEffect, useRef } from "react"
import { useLauncherClipboardStore } from "./launcher-clipboard-store"

export function useLauncherClipboardRuntime(): void {
  const applyRefreshedContext = useLauncherClipboardStore((state) => state.applyRefreshedContext)
  const refreshRequestIdRef = useRef(0)

  const refreshContext = useCallback(async (): Promise<void> => {
    const requestId = ++refreshRequestIdRef.current
    const nextContext = await window.api.launcher.getClipboardContext()
    if (requestId !== refreshRequestIdRef.current) {
      return
    }

    applyRefreshedContext(nextContext)
  }, [applyRefreshedContext])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      void refreshContext()
    })

    const cleanupShown = window.api.launcher.onShown(() => {
      return refreshContext()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      cleanupShown()
    }
  }, [refreshContext])
}
