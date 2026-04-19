import { useCallback, useEffect } from "react"
import { useLauncherClipboardStore } from "./launcher-clipboard-store"

export function useLauncherClipboardRuntime(): void {
  const applyRefreshedContext = useLauncherClipboardStore((state) => state.applyRefreshedContext)

  const refreshContext = useCallback(async (): Promise<void> => {
    const nextContext = await window.api.launcher.getClipboardContext()
    applyRefreshedContext(nextContext)
  }, [applyRefreshedContext])

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
}
