import { BrowserWindow } from "electron"
import { join } from "path"
import { startRendererWindowLoad } from "./load-renderer-window"
import { installExternalWindowOpenHandler } from "./external-window-open"
import { lockFixedWindowZoom } from "./window-zoom"
import { attachWindowDiagnostics } from "../diagnostics/electron-events"
import {
  SETTINGS_NAVIGATION_CHANGED_CHANNEL,
  type SettingsWindowNavigationDelivery
} from "@shared/settings-window"
import { getAppThemeSettings } from "../preferences"
import { createThemeTitleBarOverlay } from "./title-bar-overlay"
import { installWindowPresentation, requestWindowPresentation } from "./window-presentation"
import { registerWindowIdentity } from "./window-identity"

const SETTINGS_WINDOW_WIDTH = 1220
const SETTINGS_WINDOW_HEIGHT = 820

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
  delivery?: SettingsWindowNavigationDelivery
): void {
  requestWindowPresentation(settingsWindow)

  if (delivery) {
    try {
      settingsWindow.webContents.send(SETTINGS_NAVIGATION_CHANGED_CHANNEL, delivery)
    } catch (error) {
      console.warn("[settings] Failed to deliver navigation to the renderer.", error)
    }
  }
}
