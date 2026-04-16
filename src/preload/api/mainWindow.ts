import { ipcRenderer } from "electron"
import type { MainWindowNavigationPayload } from "../../shared/main-window"

export const mainWindowApi = {
  openWindow: (payload?: MainWindowNavigationPayload): Promise<void> => {
    return ipcRenderer.invoke("main-window:openWindow", payload)
  },
  openThread: (threadId: string): Promise<void> => {
    return ipcRenderer.invoke("main-window:openThread", threadId)
  },
  getPendingNavigation: (): Promise<MainWindowNavigationPayload | null> => {
    return ipcRenderer.invoke("main-window:getPendingNavigation")
  },
  ackNavigation: (payload: MainWindowNavigationPayload): Promise<void> => {
    return ipcRenderer.invoke("main-window:ackNavigation", payload)
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
