import { BrowserWindow } from "electron"
import { join } from "path"
import { loadRendererWindow } from "./load-renderer-window"
import { installExternalWindowOpenHandler } from "./external-window-open"
import { lockFixedWindowZoom } from "./window-zoom"
import { attachWindowDiagnostics } from "../diagnostics/electron-events"
import type { SettingsWindowNavigationPayload } from "@shared/settings-window"

const SETTINGS_WINDOW_WIDTH = 1220
const SETTINGS_WINDOW_HEIGHT = 820

export function createSettingsWindow(): BrowserWindow {
  const isMac = process.platform === "darwin"

  const settingsWindow = new BrowserWindow({
    width: SETTINGS_WINDOW_WIDTH,
    height: SETTINGS_WINDOW_HEIGHT,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: !isMac,
    backgroundColor: "#F3F4F1",
    title: "Settings",
    titleBarStyle: "hidden",
    ...(isMac
      ? {
          trafficLightPosition: { x: 16, y: 16 }
        }
      : {
          titleBarOverlay: {
            color: "#F7F6F2",
            symbolColor: "#5F6873",
            height: 52
          }
        }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  })

  attachWindowDiagnostics(settingsWindow, "settings")
  lockFixedWindowZoom(settingsWindow)

  settingsWindow.on("ready-to-show", () => {
    settingsWindow.show()
    settingsWindow.focus()
  })

  installExternalWindowOpenHandler(settingsWindow.webContents)

  void loadRendererWindow(settingsWindow, "settings")
  return settingsWindow
}

export function showSettingsWindow(
  settingsWindow: BrowserWindow,
  payload?: SettingsWindowNavigationPayload
): void {
  if (settingsWindow.isMinimized()) {
    settingsWindow.restore()
  }

  if (payload) {
    const emitPayload = (): void => {
      settingsWindow.webContents.send("settings-tab-changed", payload)
    }

    if (settingsWindow.webContents.isLoadingMainFrame()) {
      settingsWindow.webContents.once("did-finish-load", emitPayload)
    } else {
      emitPayload()
    }
  }

  settingsWindow.show()
  settingsWindow.focus()
}
