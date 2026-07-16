import { BrowserWindow } from "electron"
import { join } from "path"
import { attachWindowDiagnostics } from "../diagnostics/electron-events"
import { installExternalWindowOpenHandler } from "./external-window-open"
import { startRendererWindowLoad } from "./load-renderer-window"
import { attachMainWindowStatePersistence, getMainWindowPlacement } from "./main-window-state"
import { installWindowPresentation, requestWindowPresentation } from "./window-presentation"
import { registerWindowIdentity } from "./window-identity"

export const PRIMARY_MAIN_WINDOW_ID = "primary-main"

export function createMainWindow(threadId: string | null): BrowserWindow {
  const placement = getMainWindowPlacement()
  const isMac = process.platform === "darwin"
  const window = new BrowserWindow({
    ...placement.bounds,
    minWidth: 760,
    minHeight: 520,
    show: false,
    autoHideMenuBar: !isMac,
    backgroundColor: "#F3F4F1",
    title: "Jingle",
    titleBarStyle: "hidden",
    ...(isMac ? { trafficLightPosition: { x: 16, y: 16 } } : {
      titleBarOverlay: { color: "#F7F6F2", height: 52, symbolColor: "#5F6873" }
    }),
    webPreferences: { preload: join(__dirname, "../preload/index.js"), sandbox: false }
  })
  registerWindowIdentity(window.webContents, { kind: "main", threadId, windowId: PRIMARY_MAIN_WINDOW_ID })
  const observeFailure = attachWindowDiagnostics(window, "main")
  attachMainWindowStatePersistence(window)
  window.once("ready-to-show", () => {
    if (placement.isMaximized || placement.isFirstLaunch) window.maximize()
  })
  installWindowPresentation(window)
  installExternalWindowOpenHandler(window.webContents)
  startRendererWindowLoad(window, "main", {
    onFailure: observeFailure,
    query: threadId ? { threadId } : undefined
  })
  requestWindowPresentation(window)
  return window
}
