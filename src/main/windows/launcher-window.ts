import { BrowserWindow, type IpcMain, globalShortcut, screen } from "electron"
import { join } from "path"
import { loadRendererWindow } from "./load-renderer-window"

const LAUNCHER_WIDTH = 760
const LAUNCHER_HEIGHT = 96
export const DEFAULT_LAUNCHER_SHORTCUT = "CommandOrControl+Shift+Space"

function getLauncherBounds(): { x: number; y: number } {
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)

  return {
    x: Math.round(display.workArea.x + display.workArea.width / 2 - LAUNCHER_WIDTH / 2),
    y: Math.round(display.workArea.y + Math.max(72, display.workArea.height * 0.18))
  }
}

function showLauncherWindow(launcherWindow: BrowserWindow): void {
  const { x, y } = getLauncherBounds()
  launcherWindow.setBounds({
    x,
    y,
    width: LAUNCHER_WIDTH,
    height: LAUNCHER_HEIGHT
  })

  if (process.platform === "darwin") {
    launcherWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    launcherWindow.setAlwaysOnTop(true, "screen-saver", 1)
  } else {
    launcherWindow.setAlwaysOnTop(true)
  }

  launcherWindow.show()
  launcherWindow.focus()
  launcherWindow.moveTop()
}

function hideLauncherWindow(launcherWindow: BrowserWindow): void {
  launcherWindow.hide()
}

export function createLauncherWindow(): BrowserWindow {
  const launcherWindow = new BrowserWindow({
    width: LAUNCHER_WIDTH,
    height: LAUNCHER_HEIGHT,
    show: false,
    ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    alwaysOnTop: true,
    backgroundColor: "#101014",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  })

  launcherWindow.on("blur", () => {
    if (!launcherWindow.isDestroyed() && launcherWindow.isVisible()) {
      hideLauncherWindow(launcherWindow)
    }
  })

  void loadRendererWindow(launcherWindow, "launcher")

  return launcherWindow
}

export function registerLauncherHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("launcher:hide", (event) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender)
    currentWindow?.hide()
  })
}

export function registerLauncherShortcut(getLauncherWindow: () => BrowserWindow): void {
  const registered = globalShortcut.register(DEFAULT_LAUNCHER_SHORTCUT, () => {
    const launcherWindow = getLauncherWindow()
    if (launcherWindow.isVisible()) {
      hideLauncherWindow(launcherWindow)
      return
    }
    showLauncherWindow(launcherWindow)
  })

  if (!registered) {
    console.warn(`Failed to register launcher shortcut: ${DEFAULT_LAUNCHER_SHORTCUT}`)
  }
}

export function unregisterLauncherShortcut(): void {
  globalShortcut.unregister(DEFAULT_LAUNCHER_SHORTCUT)
}
