import { BrowserWindow, type IpcMain, globalShortcut, screen } from "electron"
import { join } from "path"
import { loadRendererWindow } from "./load-renderer-window"
import { FALLBACK_SHELL_CONFIG, getLauncherMaxViewportHeight } from "../../shared/launcher"
import type { LauncherSearchRequest } from "../../shared/launcher-search"
import { searchLauncher } from "../services/launcher-search"

const LAUNCHER_WIDTH = 800
const LAUNCHER_HORIZONTAL_MARGIN = 24
const LAUNCHER_TOP_MARGIN = 60
const MAC_LAUNCHER_WINDOW_LEVEL = "floating"
const LAUNCHER_BASE_HEIGHT = FALLBACK_SHELL_CONFIG.baseHeight
const LAUNCHER_MAX_HEIGHT = getLauncherMaxViewportHeight(FALLBACK_SHELL_CONFIG)

export const DEFAULT_LAUNCHER_SHORTCUT = "CommandOrControl+Shift+Space"

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getLauncherBounds(height = LAUNCHER_BASE_HEIGHT): {
  x: number
  y: number
  width: number
  height: number
} {
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const maxWidth = Math.max(520, display.workArea.width - LAUNCHER_HORIZONTAL_MARGIN * 2)
  const width = Math.min(LAUNCHER_WIDTH, maxWidth)
  const x = Math.round(display.workArea.x + display.workArea.width / 2 - width / 2)
  const minY = display.workArea.y + LAUNCHER_TOP_MARGIN
  const maxY = display.workArea.y + display.workArea.height - height - LAUNCHER_TOP_MARGIN
  const targetY = Math.round(display.workArea.y + display.workArea.height * 0.16)
  const y = clamp(targetY, minY, Math.max(minY, maxY))

  return {
    x,
    y,
    width,
    height
  }
}

function emitLauncherShown(launcherWindow: BrowserWindow): void {
  if (launcherWindow.webContents.isLoadingMainFrame()) {
    launcherWindow.webContents.once("did-finish-load", () => {
      if (!launcherWindow.isDestroyed()) {
        launcherWindow.webContents.send("launcher:shown")
      }
    })
    return
  }

  launcherWindow.webContents.send("launcher:shown")
}

function showLauncherWindow(launcherWindow: BrowserWindow): void {
  launcherWindow.setBounds(getLauncherBounds(LAUNCHER_BASE_HEIGHT), false)

  if (process.platform === "darwin") {
    launcherWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    //// 保持启动器位于应用窗口上方，但不遮挡输入法候选窗口。
    launcherWindow.setAlwaysOnTop(true, MAC_LAUNCHER_WINDOW_LEVEL)
  } else {
    launcherWindow.setAlwaysOnTop(true)
  }

  launcherWindow.show()
  launcherWindow.focus()
  launcherWindow.moveTop()
  emitLauncherShown(launcherWindow)

  if (process.platform === "darwin") {
    setTimeout(() => {
      if (!launcherWindow.isDestroyed() && launcherWindow.isVisible()) {
        launcherWindow.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: true })
      }
    }, 0)
  }
}

function hideLauncherWindow(launcherWindow: BrowserWindow): void {
  launcherWindow.hide()
}

export function createLauncherWindow(): BrowserWindow {
  const launcherWindow = new BrowserWindow({
    width: LAUNCHER_WIDTH,
    height: LAUNCHER_BASE_HEIGHT,
    show: false,
    ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
    frame: false,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    hasShadow: true,
    backgroundColor: "#141418",
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

  launcherWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape") {
      event.preventDefault()
      hideLauncherWindow(launcherWindow)
    }
  })

  const repositionIfVisible = (): void => {
    if (!launcherWindow.isDestroyed() && launcherWindow.isVisible()) {
      launcherWindow.setBounds(getLauncherBounds(launcherWindow.getBounds().height), false)
    }
  }

  screen.on("display-metrics-changed", repositionIfVisible)
  screen.on("display-added", repositionIfVisible)
  screen.on("display-removed", repositionIfVisible)

  launcherWindow.on("closed", () => {
    screen.removeListener("display-metrics-changed", repositionIfVisible)
    screen.removeListener("display-added", repositionIfVisible)
    screen.removeListener("display-removed", repositionIfVisible)
  })

  void loadRendererWindow(launcherWindow, "launcher")

  return launcherWindow
}

export function registerLauncherHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("launcher:getShellConfig", () => {
    return FALLBACK_SHELL_CONFIG
  })

  ipcMain.handle("launcher:search", async (_event, request: LauncherSearchRequest) => {
    return searchLauncher(request)
  })

  ipcMain.handle("launcher:hide", (event) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender)
    currentWindow?.hide()
  })

  ipcMain.handle("launcher:setViewportHeight", (event, height: number) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender)
    if (!currentWindow) {
      return
    }

    const nextHeight = clamp(Math.round(height), LAUNCHER_BASE_HEIGHT, LAUNCHER_MAX_HEIGHT)
    currentWindow.setBounds(getLauncherBounds(nextHeight), false)
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
