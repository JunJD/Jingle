import { BrowserWindow, type WebContents } from "electron"
import { join } from "path"
import { startRendererWindowLoad } from "./load-renderer-window"
import { installExternalWindowOpenHandler } from "./external-window-open"
import { lockFixedWindowZoom } from "./window-zoom"
import { attachWindowDiagnostics } from "../diagnostics/electron-events"
import {
  SETTINGS_NAVIGATION_CHANGED_CHANNEL,
  type SettingsWindowNavigationPayload
} from "@shared/settings-window"
import { getAppThemeSettings } from "../preferences"
import { createThemeTitleBarOverlay } from "./title-bar-overlay"
import { installWindowPresentation, requestWindowPresentation } from "./window-presentation"
import { registerWindowIdentity } from "./window-identity"

const SETTINGS_WINDOW_WIDTH = 1220
const SETTINGS_WINDOW_HEIGHT = 820
const settingsWindowWebContents = new WeakSet<WebContents>()

export function isSettingsWindowWebContents(webContents: WebContents): boolean {
  return settingsWindowWebContents.has(webContents) && !webContents.isDestroyed()
}

export function createSettingsWindow(): BrowserWindow {
  const isMac = process.platform === "darwin"
  const appThemeSettings = getAppThemeSettings()

  const settingsWindow = new BrowserWindow({
    width: SETTINGS_WINDOW_WIDTH,
    height: SETTINGS_WINDOW_HEIGHT,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: !isMac,
    backgroundColor: appThemeSettings.config.theme.surface,
    title: "Settings",
    titleBarStyle: "hidden",
    ...(isMac
      ? {
          trafficLightPosition: { x: 16, y: 16 }
        }
      : { titleBarOverlay: createThemeTitleBarOverlay(appThemeSettings) }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  })
  registerWindowIdentity(settingsWindow.webContents, { kind: "settings" })
  settingsWindowWebContents.add(settingsWindow.webContents)

  const observeRendererWindowLoadFailure = attachWindowDiagnostics(settingsWindow, "settings")
  lockFixedWindowZoom(settingsWindow)
  installWindowPresentation(settingsWindow)

  installExternalWindowOpenHandler(settingsWindow.webContents)

  startRendererWindowLoad(settingsWindow, "settings", {
    onFailure: observeRendererWindowLoadFailure
  })
  return settingsWindow
}

export function showSettingsWindow(
  settingsWindow: BrowserWindow,
  payload?: SettingsWindowNavigationPayload
): void {
  if (payload) {
    settingsWindow.webContents.send(SETTINGS_NAVIGATION_CHANGED_CHANNEL, payload)
  }

  requestWindowPresentation(settingsWindow)
}
