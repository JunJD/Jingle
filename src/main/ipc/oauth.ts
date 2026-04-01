import type { BrowserWindow, IpcMain } from "electron"
import type { OAuthTokenRecord } from "../../shared/oauth"
import { getOAuthToken, removeOAuthToken, setOAuthToken } from "../oauth-store"

export function registerOAuthHandlers(params: {
  getLauncherWindow: () => BrowserWindow | null
  ipcMain: IpcMain
  setFlowActive: (active: boolean) => void
}): void {
  const { getLauncherWindow, ipcMain, setFlowActive } = params

  ipcMain.handle("oauth:getToken", (_event, provider: string) => {
    return getOAuthToken(provider)
  })

  ipcMain.handle("oauth:setToken", (_event, provider: string, token: OAuthTokenRecord) => {
    setOAuthToken(provider, token)
  })

  ipcMain.handle("oauth:removeToken", (_event, provider: string) => {
    removeOAuthToken(provider)
  })

  ipcMain.handle("oauth:logout", (_event, provider: string) => {
    removeOAuthToken(provider)
    const launcherWindow = getLauncherWindow()
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      launcherWindow.webContents.send("oauth:logout", provider)
    }
  })

  ipcMain.handle("oauth:setFlowActive", (_event, active: boolean) => {
    setFlowActive(Boolean(active))
  })
}
