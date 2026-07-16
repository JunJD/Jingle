import { useCallback, useEffect } from "react"
import { useLauncherClipboardStore } from "./launcher-clipboard-store"

let latestClipboardRefreshRequestId = 0

export function useLauncherClipboardRuntime(): void {
  const applyRefreshedContext = useLauncherClipboardStore((state) => state.applyRefreshedContext)

  const refreshContext = useCallback(
    async (
      deadlineAt = Number.POSITIVE_INFINITY,
      isCurrent: () => boolean = () => true
    ): Promise<void> => {
      const requestId = ++latestClipboardRefreshRequestId
      const nextContext = await window.api.launcher.getClipboardContext()
      if (
        requestId !== latestClipboardRefreshRequestId ||
        Date.now() >= deadlineAt ||
        !isCurrent()
      ) {
        return
      }

      applyRefreshedContext(nextContext)
    },
    [applyRefreshedContext]
  )

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      void refreshContext().catch((error: unknown) => {
        console.error("[launcher] failed to refresh clipboard context", error)
      })
    })

    const cleanupShown = window.api.launcher.onShown((event) => {
      return refreshContext(event.deadlineAt, event.isCurrent)
    })

    return () => {
      latestClipboardRefreshRequestId += 1
      window.cancelAnimationFrame(frameId)
      cleanupShown()
    }
  }, [refreshContext])
}
