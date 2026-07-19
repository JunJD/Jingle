import { BrowserWindow } from "electron"
import { join } from "path"
import { DURABLE_WINDOW_HEADER_HEIGHT } from "@shared/durable-window"
import { attachWindowDiagnostics } from "../diagnostics/electron-events"
import { getAppThemeSettings } from "../preferences"
import { installExternalWindowOpenHandler } from "./external-window-open"
import { startRendererWindowLoad } from "./load-renderer-window"
import { attachMainWindowStatePersistence, getMainWindowPlacement } from "./main-window-state"
import { createThemeTitleBarOverlay } from "./title-bar-overlay"
import { installWindowPresentation, requestWindowPresentation } from "./window-presentation"
import { registerWindowIdentity } from "./window-identity"

export const PRIMARY_MAIN_WINDOW_ID = "primary-main"

export function createMainWindow(threadId: string | null): BrowserWindow {
  const placement = getMainWindowPlacement()
  const isMac = process.platform === "darwin"
  const appThemeSettings = getAppThemeSettings()
  const window = new BrowserWindow({
    ...placement.bounds,
    minWidth: 760,
    minHeight: 520,
    show: false,
    autoHideMenuBar: !isMac,
    backgroundColor: appThemeSettings.config.theme.surface,
    title: "Jingle",
    titleBarStyle: "hidden",
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : {
          titleBarOverlay: createThemeTitleBarOverlay(appThemeSettings, {
            height: DURABLE_WINDOW_HEADER_HEIGHT
          })
        }),
    webPreferences: { preload: join(__dirname, "../preload/index.js"), sandbox: false }
  })
  registerWindowIdentity(window.webContents, {
    kind: "main",
    threadId,
    windowId: PRIMARY_MAIN_WINDOW_ID
  })
  const observeFailure = attachWindowDiagnostics(window, "main")
  attachMainWindowStatePersistence(window)
  installWindowPresentation(window, {
    maximizeOnActivation: placement.isMaximized || placement.isFirstLaunch
  })
  installExternalWindowOpenHandler(window.webContents)
  startRendererWindowLoad(window, "main", {
    onFailure: observeFailure,
    query: threadId ? { threadId } : undefined
  })
  requestWindowPresentation(window)
  return window
}
