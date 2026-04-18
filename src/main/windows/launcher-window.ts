import { BrowserWindow, type Rectangle, screen } from "electron"
import { join } from "path"
import { loadRendererWindow } from "./load-renderer-window"
import {
  FALLBACK_SHELL_CONFIG,
  getLauncherIdleHeight,
  getLauncherMaxViewportHeight
} from "../../shared/launcher"

const LAUNCHER_CONTENT_WIDTH = 760
const LAUNCHER_HORIZONTAL_MARGIN = 24
const LAUNCHER_TOP_MARGIN = 60
const LAUNCHER_VERTICAL_POSITION_RATIO = 0.28
const MAC_LAUNCHER_WINDOW_LEVEL = "floating"
const LAUNCHER_BASE_HEIGHT = getLauncherIdleHeight(FALLBACK_SHELL_CONFIG)
const LAUNCHER_MAX_HEIGHT = getLauncherMaxViewportHeight(FALLBACK_SHELL_CONFIG)
const LAUNCHER_MAX_SCREEN_HEIGHT_RATIO = 0.7
const LAUNCHER_WINDOW_GUTTER = process.platform === "win32" ? 12 : 0
const WINDOWS_LAUNCHER_SHAPE_RADIUS = 12
const launcherVisibleOrigins = new WeakMap<BrowserWindow, { x: number; y: number }>()
let launcherBlurHideSuppressionDepth = 0

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getLauncherWindowWidthForDisplay(display: Electron.Display): number {
  const maxContentWidth = Math.max(
    520,
    display.workArea.width - LAUNCHER_HORIZONTAL_MARGIN * 2 - LAUNCHER_WINDOW_GUTTER * 2
  )
  const contentWidth = Math.min(LAUNCHER_CONTENT_WIDTH, maxContentWidth)
  return contentWidth + LAUNCHER_WINDOW_GUTTER * 2
}

function getLauncherWindowHeight(display: Electron.Display, requestedHeight: number): number {
  return getLauncherHeightForDisplay(display, requestedHeight) + LAUNCHER_WINDOW_GUTTER * 2
}

function getLauncherContentHeight(windowHeight: number): number {
  return Math.max(LAUNCHER_BASE_HEIGHT, Math.round(windowHeight) - LAUNCHER_WINDOW_GUTTER * 2)
}

function getLauncherBounds(height = LAUNCHER_BASE_HEIGHT): Rectangle {
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const boundedHeight = getLauncherWindowHeight(display, height)
  const width = getLauncherWindowWidthForDisplay(display)
  const x = Math.round(display.workArea.x + display.workArea.width / 2 - width / 2)
  const minY = display.workArea.y + LAUNCHER_TOP_MARGIN
  const maxY = display.workArea.y + display.workArea.height - boundedHeight - LAUNCHER_TOP_MARGIN
  const targetY = Math.round(minY + (maxY - minY) * LAUNCHER_VERTICAL_POSITION_RATIO)
  const y = clamp(targetY, minY, Math.max(minY, maxY))

  return {
    x,
    y,
    width,
    height: boundedHeight
  }
}

function getLauncherHeightForDisplay(display: Electron.Display, requestedHeight: number): number {
  const maxHeightByScreen = Math.floor(display.workArea.height * LAUNCHER_MAX_SCREEN_HEIGHT_RATIO)
  const maxHeight = Math.max(LAUNCHER_BASE_HEIGHT, Math.min(LAUNCHER_MAX_HEIGHT, maxHeightByScreen))

  return clamp(Math.round(requestedHeight), LAUNCHER_BASE_HEIGHT, maxHeight)
}

function getVisibleLauncherBounds(params: {
  anchorX: number
  anchorY: number
  height: number
  launcherWindow: BrowserWindow
}): Rectangle {
  const { anchorX, anchorY, height, launcherWindow } = params
  const currentBounds = launcherWindow.getBounds()
  const display = screen.getDisplayMatching(currentBounds)
  const boundedHeight = getLauncherWindowHeight(display, height)
  const minX = display.workArea.x + LAUNCHER_HORIZONTAL_MARGIN
  const maxX =
    display.workArea.x + display.workArea.width - currentBounds.width - LAUNCHER_HORIZONTAL_MARGIN
  const minY = display.workArea.y + LAUNCHER_TOP_MARGIN
  const maxY = display.workArea.y + display.workArea.height - boundedHeight - LAUNCHER_TOP_MARGIN

  return {
    x: clamp(anchorX, minX, Math.max(minX, maxX)),
    y: clamp(anchorY, minY, Math.max(minY, maxY)),
    width: currentBounds.width,
    height: boundedHeight
  }
}

function buildRoundedRectShape(width: number, height: number, radius: number): Rectangle[] {
  if (width <= 0 || height <= 0) {
    return []
  }

  const boundedRadius = clamp(Math.round(radius), 0, Math.floor(Math.min(width, height) / 2))
  if (boundedRadius === 0) {
    return [{ x: 0, y: 0, width, height }]
  }

  const rects: Rectangle[] = []
  let currentRect: Rectangle | null = null

  for (let y = 0; y < height; y += 1) {
    const topDy = Math.max(0, boundedRadius - (y + 0.5))
    const bottomDy = Math.max(0, y + 0.5 - (height - boundedRadius))
    const cornerDy = Math.max(topDy, bottomDy)
    const inset =
      cornerDy > 0
        ? Math.max(
            0,
            Math.ceil(
              boundedRadius - Math.sqrt(boundedRadius * boundedRadius - cornerDy * cornerDy)
            )
          )
        : 0
    const lineWidth = Math.max(1, width - inset * 2)
    const lineX = inset

    if (
      currentRect &&
      currentRect.x === lineX &&
      currentRect.width === lineWidth &&
      currentRect.y + currentRect.height === y
    ) {
      currentRect.height += 1
      continue
    }

    currentRect = { x: lineX, y, width: lineWidth, height: 1 }
    rects.push(currentRect)
  }

  return rects
}

function offsetShapeRectangles(rectangles: Rectangle[], x: number, y: number): Rectangle[] {
  return rectangles.map((rectangle) => ({
    ...rectangle,
    x: rectangle.x + x,
    y: rectangle.y + y
  }))
}

function syncLauncherWindowShape(launcherWindow: BrowserWindow): void {
  if (process.platform !== "win32" || launcherWindow.isDestroyed()) {
    return
  }

  if (LAUNCHER_WINDOW_GUTTER > 0) {
    return
  }

  const { width, height } = launcherWindow.getBounds()
  launcherWindow.setShape(
    offsetShapeRectangles(
      buildRoundedRectShape(
        width - LAUNCHER_WINDOW_GUTTER * 2,
        height - LAUNCHER_WINDOW_GUTTER * 2,
        WINDOWS_LAUNCHER_SHAPE_RADIUS
      ),
      LAUNCHER_WINDOW_GUTTER,
      LAUNCHER_WINDOW_GUTTER
    )
  )
}

function setLauncherWindowBounds(launcherWindow: BrowserWindow, bounds: Rectangle): void {
  launcherWindow.setBounds(bounds, false)
  syncLauncherWindowShape(launcherWindow)
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

export function showLauncherWindow(launcherWindow: BrowserWindow): void {
  const nextHeight = getLauncherContentHeight(
    launcherWindow.getBounds().height || LAUNCHER_BASE_HEIGHT
  )
  const nextBounds = getLauncherBounds(nextHeight)
  setLauncherWindowBounds(launcherWindow, nextBounds)

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

export function setLauncherBlurHideSuppressed(active: boolean): void {
  if (active) {
    launcherBlurHideSuppressionDepth += 1
    return
  }

  launcherBlurHideSuppressionDepth = Math.max(0, launcherBlurHideSuppressionDepth - 1)
}

export function setLauncherWindowViewportHeight(
  launcherWindow: BrowserWindow,
  height: number
): void {
  const visibleOrigin = launcherVisibleOrigins.get(launcherWindow)

  setLauncherWindowBounds(
    launcherWindow,
    launcherWindow.isVisible()
      ? getVisibleLauncherBounds({
          anchorX: visibleOrigin?.x ?? launcherWindow.getBounds().x,
          anchorY: visibleOrigin?.y ?? launcherWindow.getBounds().y,
          height,
          launcherWindow
        })
      : getLauncherBounds(height)
  )
}

export function createLauncherWindow(): BrowserWindow {
  const launcherWindow = new BrowserWindow({
    width: LAUNCHER_CONTENT_WIDTH + LAUNCHER_WINDOW_GUTTER * 2,
    height: LAUNCHER_BASE_HEIGHT + LAUNCHER_WINDOW_GUTTER * 2,
    show: false,
    autoHideMenuBar: process.platform !== "darwin",
    ...(process.platform === "darwin"
      ? {
          type: "panel" as const,
          vibrancy: "popover" as const,
          visualEffectState: "active" as const
        }
      : {}),
    ...(process.platform === "win32"
      ? {
          backgroundMaterial: "none" as const,
          hasShadow: false,
          roundedCorners: true
        }
      : {
          hasShadow: true
        }),
    frame: false,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  })

  launcherWindow.on("blur", () => {
    if (launcherBlurHideSuppressionDepth > 0) {
      return
    }

    if (!launcherWindow.isDestroyed() && launcherWindow.isVisible()) {
      hideLauncherWindow(launcherWindow)
    }
  })

  launcherWindow.on("resize", () => {
    syncLauncherWindowShape(launcherWindow)
  })

  launcherWindow.on("show", () => {
    const { x, y } = launcherWindow.getBounds()
    launcherVisibleOrigins.set(launcherWindow, { x, y })
  })

  launcherWindow.on("hide", () => {
    launcherVisibleOrigins.delete(launcherWindow)
  })

  launcherWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape") {
      event.preventDefault()
      hideLauncherWindow(launcherWindow)
    }
  })

  const repositionIfVisible = (): void => {
    if (!launcherWindow.isDestroyed() && launcherWindow.isVisible()) {
      const nextBounds = getLauncherBounds(
        getLauncherContentHeight(launcherWindow.getBounds().height)
      )
      launcherVisibleOrigins.set(launcherWindow, {
        x: nextBounds.x,
        y: nextBounds.y
      })
      setLauncherWindowBounds(launcherWindow, nextBounds)
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

  syncLauncherWindowShape(launcherWindow)
  void loadRendererWindow(launcherWindow, "launcher")

  return launcherWindow
}
