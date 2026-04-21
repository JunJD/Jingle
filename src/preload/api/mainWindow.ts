import type { MainWindowNavigationPayload } from "@shared/main-window"
import { invokeIpc, ipcRenderer } from "../ipc"

export const mainWindowApi = {
  openWindow: (payload?: MainWindowNavigationPayload): Promise<void> => {
    return invokeIpc("main-window:openWindow", payload)
  },
  openThread: (threadId: string): Promise<void> => {
    return invokeIpc("main-window:openThread", threadId)
  },
  getPendingNavigation: (): Promise<MainWindowNavigationPayload | null> => {
    return invokeIpc("main-window:getPendingNavigation")
  },
  ackNavigation: (payload: MainWindowNavigationPayload): Promise<void> => {
    return invokeIpc("main-window:ackNavigation", payload)
  },
  onNavigate: (callback: (payload: MainWindowNavigationPayload) => void): (() => void) => {
    const handler = (_event: unknown, payload: MainWindowNavigationPayload): void => {
      callback(payload)
    }

    ipcRenderer.on("main-window:navigate", handler)
    return () => {
      ipcRenderer.removeListener("main-window:navigate", handler)
    }
  }
}
