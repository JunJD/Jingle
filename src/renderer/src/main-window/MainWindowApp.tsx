import { useCallback, useEffect, useState } from "react"
import HistoryApp from "@ai-core/history"
import type { MainWindowNavigationPayload } from "../../../shared/main-window"

export default function MainWindowApp(): React.JSX.Element {
  const [targetThreadId, setTargetThreadId] = useState<string | undefined>(undefined)

  const acknowledgeNavigation = useCallback((payload: MainWindowNavigationPayload): void => {
    void window.api.mainWindow.ackNavigation(payload)
  }, [])

  const handleTargetThreadHandled = useCallback(
    (result: { matched: boolean; targetThreadId: string }): void => {
      acknowledgeNavigation({ targetThreadId: result.targetThreadId })
      setTargetThreadId((currentTargetThreadId) =>
        currentTargetThreadId === result.targetThreadId ? undefined : currentTargetThreadId
      )
    },
    [acknowledgeNavigation]
  )

  useEffect(() => {
    let disposed = false

    const applyNavigation = (payload: MainWindowNavigationPayload | null | undefined): void => {
      if (disposed) {
        return
      }

      if (payload?.targetThreadId) {
        setTargetThreadId(payload.targetThreadId)
      }
    }

    const unsubscribe = window.api.mainWindow.onNavigate((payload) => {
      applyNavigation(payload)
    })

    void window.api.mainWindow.getPendingNavigation().then((payload) => {
      applyNavigation(payload)
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return (
    <HistoryApp onTargetThreadHandled={handleTargetThreadHandled} targetThreadId={targetThreadId} />
  )
}
