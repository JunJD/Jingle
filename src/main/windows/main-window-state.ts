import { BrowserWindow, screen, type Rectangle } from "electron"
import type { PersistedWindowState } from "../preferences"
import { getMainWindowState, setMainWindowState } from "../preferences"

const DEFAULT_MAIN_WINDOW_WIDTH = 1440
const DEFAULT_MAIN_WINDOW_HEIGHT = 900
const MAIN_WINDOW_MIN_WIDTH = 1200
const MAIN_WINDOW_MIN_HEIGHT = 700

export interface MainWindowPlacement {
  bounds: Rectangle
  isMaximized: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function centerCoordinate(start: number, span: number, size: number): number {
  return Math.round(start + (span - size) / 2)
}

function resolveDisplayForState(windowState: PersistedWindowState | null): Electron.Display {
  if (!windowState) {
    return screen.getPrimaryDisplay()
  }

  return screen.getDisplayMatching({
    x: windowState.x ?? 0,
    y: windowState.y ?? 0,
    width: windowState.width,
    height: windowState.height
  })
}

export function getMainWindowPlacement(): MainWindowPlacement {
  const storedState = getMainWindowState()
  const display = resolveDisplayForState(storedState)
  const { workArea } = display
  const minWidth = Math.min(MAIN_WINDOW_MIN_WIDTH, workArea.width)
  const minHeight = Math.min(MAIN_WINDOW_MIN_HEIGHT, workArea.height)
  const width = clamp(storedState?.width ?? DEFAULT_MAIN_WINDOW_WIDTH, minWidth, workArea.width)
  const height = clamp(
    storedState?.height ?? DEFAULT_MAIN_WINDOW_HEIGHT,
    minHeight,
    workArea.height
  )
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - width)
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - height)

  return {
    bounds: {
      x:
        storedState?.x === undefined
          ? centerCoordinate(workArea.x, workArea.width, width)
          : clamp(storedState.x, workArea.x, maxX),
      y:
        storedState?.y === undefined
          ? centerCoordinate(workArea.y, workArea.height, height)
          : clamp(storedState.y, workArea.y, maxY),
      width,
      height
    },
    isMaximized: storedState?.isMaximized === true
  }
}

function persistMainWindowState(browserWindow: BrowserWindow): void {
  if (browserWindow.isDestroyed()) {
    return
  }

  const normalBounds = browserWindow.getNormalBounds()
  setMainWindowState({
    x: normalBounds.x,
    y: normalBounds.y,
    width: normalBounds.width,
    height: normalBounds.height,
    isMaximized: browserWindow.isMaximized()
  })
}

export function attachMainWindowStatePersistence(browserWindow: BrowserWindow): void {
  const persist = (): void => {
    persistMainWindowState(browserWindow)
  }

  browserWindow.on("move", persist)
  browserWindow.on("resize", persist)
  browserWindow.on("maximize", persist)
  browserWindow.on("unmaximize", persist)
  browserWindow.on("close", persist)
}
