import type { IpcMain } from "electron"
import type { MainWindowNavigationPayload } from "../../shared/main-window"

export function registerMainWindowHandlers(params: {
  acknowledgePendingNavigation: (payload: MainWindowNavigationPayload) => void
  getPendingNavigation: () => MainWindowNavigationPayload | null
  ipcMain: IpcMain
  openMainWindow: (payload?: MainWindowNavigationPayload) => void
}): void {
  const { acknowledgePendingNavigation, getPendingNavigation, ipcMain, openMainWindow } = params

  ipcMain.handle("main-window:openWindow", (_event, payload?: MainWindowNavigationPayload) => {
    openMainWindow(payload)
  })

  ipcMain.handle("main-window:openThread", (_event, threadId: string) => {
    openMainWindow({ threadId })
  })

  ipcMain.handle("main-window:getPendingNavigation", () => {
    return getPendingNavigation()
  })

  ipcMain.handle("main-window:ackNavigation", (_event, payload: MainWindowNavigationPayload) => {
    acknowledgePendingNavigation(payload)
  })
}
