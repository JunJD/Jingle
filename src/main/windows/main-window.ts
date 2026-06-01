import { BrowserWindow, shell } from "electron"
import { join } from "path"
import { loadRendererWindow } from "./load-renderer-window"
import type { MainWindowNavigationPayload } from "@shared/main-window"

const MAIN_WINDOW_WIDTH = 1380
const MAIN_WINDOW_HEIGHT = 900

export function createMainWindow(): BrowserWindow {
  const isMac = process.platform === "darwin"

  const mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: !isMac,
    backgroundColor: "#F3F4F1",
    title: "Jingle",
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

  mainWindow.on("ready-to-show", () => {
    mainWindow.show()
    mainWindow.focus()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: "deny" }
  })

  void loadRendererWindow(mainWindow, "main")
  return mainWindow
}

export function showMainWindow(
  mainWindow: BrowserWindow,
  payload?: MainWindowNavigationPayload
): void {
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  if (payload && !mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.send("main-window:navigate", payload)
  }

  mainWindow.show()
  mainWindow.focus()
}
