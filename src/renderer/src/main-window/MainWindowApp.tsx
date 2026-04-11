import { useCallback, useEffect, useState } from "react"
import HistoryApp from "@ai-core/history"
import type { MainWindowNavigationPayload } from "../../../shared/main-window"

interface MainWindowThreadNavigation {
  sequence: number
  threadId: string
}

export default function MainWindowApp(): React.JSX.Element {
  const [threadNavigation, setThreadNavigation] = useState<MainWindowThreadNavigation | null>(null)

  const acknowledgeNavigation = useCallback((threadId: string): void => {
    void window.api.mainWindow.ackNavigation({ threadId })
  }, [])

  useEffect(() => {
    let disposed = false

    const applyNavigation = (payload: MainWindowNavigationPayload | null | undefined): void => {
      if (disposed || !payload?.threadId) {
        return
      }

      const { threadId } = payload
      setThreadNavigation((current) => ({
        sequence: (current?.sequence ?? 0) + 1,
        threadId
      }))
    }

    void window.api.mainWindow.getPendingNavigation().then((payload) => {
      applyNavigation(payload)
    })

    const unsubscribe = window.api.mainWindow.onNavigate((payload) => {
      applyNavigation(payload)
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return (
    <HistoryApp
      onNavigationConsumed={acknowledgeNavigation}
      navigationSequence={threadNavigation?.sequence ?? 0}
      navigationThreadId={threadNavigation?.threadId}
    />
  )
}
