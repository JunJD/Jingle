import { BrowserWindow, type Rectangle, screen, type WebContents } from "electron"
import { join } from "path"
import { installExternalWindowOpenHandler } from "./external-window-open"
import { startRendererWindowLoad } from "./load-renderer-window"
import { lockFixedWindowZoom } from "./window-zoom"
import { attachWindowDiagnostics } from "../diagnostics/electron-events"
import {
  FALLBACK_SHELL_CONFIG,
  getLauncherIdleHeight,
  getLauncherMaxViewportHeight
} from "@shared/launcher"
import { getLauncherWindowState, setLauncherWindowState } from "../preferences"
import { attachLauncherWindowDragController } from "./launcher-window-drag-controller"
import type { LauncherShownEvent } from "@shared/launcher-presentation"
import { diagnosticsLogger } from "../diagnostics/instance"
import { registerWindowIdentity } from "./window-identity"
import { claimWindowActivation } from "./window-presentation"

const LAUNCHER_CONTENT_WIDTH = 760
const LAUNCHER_HORIZONTAL_MARGIN = 24
const LAUNCHER_TOP_MARGIN = 60
const LAUNCHER_VERTICAL_POSITION_RATIO = 0.28
const MAC_LAUNCHER_WINDOW_LEVEL = "floating"
const LAUNCHER_BASE_HEIGHT = getLauncherIdleHeight(FALLBACK_SHELL_CONFIG)
const LAUNCHER_MAX_HEIGHT = getLauncherMaxViewportHeight(FALLBACK_SHELL_CONFIG)
const LAUNCHER_POSITION_REFERENCE_HEIGHT = LAUNCHER_MAX_HEIGHT
const LAUNCHER_MAX_SCREEN_HEIGHT_RATIO = 0.7
const LAUNCHER_WINDOW_GUTTER = process.platform === "win32" ? 12 : 0
const WINDOWS_LAUNCHER_SHAPE_RADIUS = 12
const WINDOWS_LAUNCHER_PRESENT_TIMEOUT_MS = 500
const launcherVisibleOrigins = new WeakMap<BrowserWindow, { x: number; y: number }>()
const launcherWindowWebContents = new WeakSet<WebContents>()
const launcherWindowsShownOnce = new WeakSet<BrowserWindow>()
const launcherPresentationStates = new WeakMap<
  BrowserWindow,
  { id: number; timeout: NodeJS.Timeout | null }
>()
let launcherBlurHideSuppressionDepth = 0
let nextLauncherPresentationId = 0

export function isLauncherWindowWebContents(webContents: WebContents): boolean {
  return launcherWindowWebContents.has(webContents) && !webContents.isDestroyed()
}

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

function getLauncherBoundsForDisplay(
  display: Electron.Display,
  height = LAUNCHER_BASE_HEIGHT,
  origin?: { x: number; y: number }
): Rectangle {
  const boundedHeight = getLauncherWindowHeight(display, height)
  const positionReferenceHeight = getLauncherWindowHeight(
    display,
    LAUNCHER_POSITION_REFERENCE_HEIGHT
  )
  const width = getLauncherWindowWidthForDisplay(display)
  const minX = display.workArea.x + LAUNCHER_HORIZONTAL_MARGIN
  const maxX = display.workArea.x + display.workArea.width - width - LAUNCHER_HORIZONTAL_MARGIN
  const x =
    origin === undefined
      ? Math.round(display.workArea.x + display.workArea.width / 2 - width / 2)
      : clamp(origin.x, minX, Math.max(minX, maxX))
  const minY = display.workArea.y + LAUNCHER_TOP_MARGIN
  const maxY = display.workArea.y + display.workArea.height - boundedHeight - LAUNCHER_TOP_MARGIN
  const referenceMaxY =
    display.workArea.y + display.workArea.height - positionReferenceHeight - LAUNCHER_TOP_MARGIN
  const targetY = Math.round(minY + (referenceMaxY - minY) * LAUNCHER_VERTICAL_POSITION_RATIO)
  const y =
    origin === undefined
      ? clamp(targetY, minY, Math.max(minY, maxY))
      : clamp(origin.y, minY, Math.max(minY, maxY))

  return {
    x,
    y,
    width,
    height: boundedHeight
  }
}

function getLauncherBounds(
  height = LAUNCHER_BASE_HEIGHT,
  origin?: { x: number; y: number }
): Rectangle {
  const display = origin
    ? screen.getDisplayNearestPoint(origin)
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())

  return getLauncherBoundsForDisplay(display, height, origin)
}

function getLauncherViewportGuideBounds(launcherWindow: BrowserWindow): Rectangle {
  const currentBounds = launcherWindow.getContentBounds()
  const display = screen.getDisplayMatching(currentBounds)

  return getLauncherBoundsForDisplay(display, getLauncherContentHeight(currentBounds.height))
}

function getLauncherHeightForDisplay(display: Electron.Display, requestedHeight: number): number {
  const maxHeightByScreen = Math.floor(display.workArea.height * LAUNCHER_MAX_SCREEN_HEIGHT_RATIO)
  const maxHeight = Math.max(LAUNCHER_BASE_HEIGHT, maxHeightByScreen)

  return clamp(Math.round(requestedHeight), LAUNCHER_BASE_HEIGHT, maxHeight)
}

function getVisibleLauncherBounds(params: {
  anchorX: number
  anchorY: number
  height: number
  launcherWindow: BrowserWindow
}): Rectangle {
  const { anchorX, anchorY, height, launcherWindow } = params
  const currentBounds = launcherWindow.getContentBounds()
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

function setLauncherWindowContentBounds(launcherWindow: BrowserWindow, bounds: Rectangle): void {
  const currentBounds = launcherWindow.getContentBounds()
  if (
    currentBounds.x === bounds.x &&
    currentBounds.y === bounds.y &&
    currentBounds.width === bounds.width &&
    currentBounds.height === bounds.height
  ) {
    return
  }

  launcherWindow.setContentBounds(bounds, false)
  if (currentBounds.width !== bounds.width || currentBounds.height !== bounds.height) {
    syncLauncherWindowShape(launcherWindow)
  }
}

function cancelLauncherPresentation(launcherWindow: BrowserWindow): void {
  const presentation = launcherPresentationStates.get(launcherWindow)
  if (presentation?.timeout) {
    clearTimeout(presentation.timeout)
  }
  launcherPresentationStates.delete(launcherWindow)
}

export function presentLauncherWindow(launcherWindow: BrowserWindow, presentationId: number): void {
  const presentation = launcherPresentationStates.get(launcherWindow)
  if (!presentation || presentation.id !== presentationId) {
    return
  }

  cancelLauncherPresentation(launcherWindow)
}

function beginLauncherPresentation(launcherWindow: BrowserWindow): LauncherShownEvent {
  cancelLauncherPresentation(launcherWindow)
  const presentationId = ++nextLauncherPresentationId
  const awaitPresentationAcknowledgement =
    process.platform === "win32" && launcherWindowsShownOnce.has(launcherWindow)
  let timeout: NodeJS.Timeout | null = null

  if (awaitPresentationAcknowledgement) {
    timeout = setTimeout(() => {
      const presentation = launcherPresentationStates.get(launcherWindow)
      if (!presentation || presentation.id !== presentationId) {
        return
      }

      diagnosticsLogger.warn("Launcher presentation readiness timed out", {
        presentationId,
        windowId: launcherWindow.id
      })
      presentLauncherWindow(launcherWindow, presentationId)
    }, WINDOWS_LAUNCHER_PRESENT_TIMEOUT_MS)
    timeout.unref()
  }

  launcherPresentationStates.set(launcherWindow, { id: presentationId, timeout })
  return { presentationId }
}

function sendLauncherShownIfCurrent(
  launcherWindow: BrowserWindow,
  event: LauncherShownEvent
): void {
  const presentation = launcherPresentationStates.get(launcherWindow)
  if (
    launcherWindow.isDestroyed() ||
    !launcherWindow.isVisible() ||
    presentation?.id !== event.presentationId
  ) {
    return
  }

  launcherWindow.webContents.send("launcher:shown", event)
}

function emitLauncherShown(launcherWindow: BrowserWindow, event: LauncherShownEvent): void {
  if (launcherWindow.webContents.isLoadingMainFrame()) {
    launcherWindow.webContents.once("did-finish-load", () => {
      sendLauncherShownIfCurrent(launcherWindow, event)
    })
    return
  }

  sendLauncherShownIfCurrent(launcherWindow, event)
}

export function showLauncherWindow(launcherWindow: BrowserWindow): void {
  if (launcherWindow.isVisible()) {
    if (!launcherWindow.isFocused()) {
      claimWindowActivation()
      launcherWindow.focus()
      launcherWindow.moveTop()
    }
    return
  }

  const shownEvent = beginLauncherPresentation(launcherWindow)
  const nextHeight = getLauncherContentHeight(
    launcherWindow.getContentBounds().height || LAUNCHER_BASE_HEIGHT
  )
  const nextBounds = getLauncherBounds(nextHeight, getLauncherWindowState() ?? undefined)
  setLauncherWindowContentBounds(launcherWindow, nextBounds)

  if (process.platform === "darwin") {
    launcherWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    launcherWindow.setAlwaysOnTop(true, MAC_LAUNCHER_WINDOW_LEVEL)
  } else {
    launcherWindow.setAlwaysOnTop(true)
  }

  claimWindowActivation()
  launcherWindow.show()
  if (process.platform === "darwin" || process.platform === "win32") {
    launcherWindow.focus()
    launcherWindow.moveTop()
  }
  launcherWindowsShownOnce.add(launcherWindow)
  emitLauncherShown(launcherWindow, shownEvent)
}

function hideLauncherWindow(launcherWindow: BrowserWindow): void {
  launcherWindow.hide()
}

function persistLauncherWindowOrigin(launcherWindow: BrowserWindow): void {
  if (launcherWindow.isDestroyed()) {
    return
  }

  const { x, y } = launcherWindow.getContentBounds()
  launcherVisibleOrigins.set(launcherWindow, { x, y })
  setLauncherWindowState({ x, y })
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

  setLauncherWindowContentBounds(
    launcherWindow,
    launcherWindow.isVisible()
      ? getVisibleLauncherBounds({
          anchorX: visibleOrigin?.x ?? launcherWindow.getContentBounds().x,
          anchorY: visibleOrigin?.y ?? launcherWindow.getContentBounds().y,
          height,
          launcherWindow
        })
      : getLauncherBounds(height, getLauncherWindowState() ?? undefined)
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
          // Electron's macOS panel type adds NSWindowStyleMaskNonactivatingPanel,
          // which is the documented path for floating above full-screen apps.
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
  registerWindowIdentity(launcherWindow.webContents, { kind: "launcher" })
  launcherWindowWebContents.add(launcherWindow.webContents)
  const observeRendererWindowLoadFailure = attachWindowDiagnostics(launcherWindow, "launcher")
  lockFixedWindowZoom(launcherWindow)

  const launcherDragController = attachLauncherWindowDragController({
    getGuideBounds: () => getLauncherViewportGuideBounds(launcherWindow),
    launcherWindow,
    persistOrigin: () => persistLauncherWindowOrigin(launcherWindow),
    setContentBounds: (bounds) => setLauncherWindowContentBounds(launcherWindow, bounds)
  })

  launcherWindow.on("blur", () => {
    if (launcherDragController.isDragging()) {
      return
    }

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
    const { x, y } = launcherWindow.getContentBounds()
    launcherVisibleOrigins.set(launcherWindow, { x, y })
  })

  launcherWindow.on("hide", () => {
    cancelLauncherPresentation(launcherWindow)
    launcherDragController.cancel()
    launcherVisibleOrigins.delete(launcherWindow)
    if (process.platform === "darwin") {
      launcherWindow.setAlwaysOnTop(false)
      launcherWindow.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: true })
    }
  })

  launcherWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape") {
      event.preventDefault()
      hideLauncherWindow(launcherWindow)
    }
  })

  installExternalWindowOpenHandler(launcherWindow.webContents)

  const repositionIfVisible = (): void => {
    if (!launcherWindow.isDestroyed() && launcherWindow.isVisible()) {
      const visibleOrigin = launcherVisibleOrigins.get(launcherWindow)
      const nextBounds = getLauncherBounds(
        getLauncherContentHeight(launcherWindow.getContentBounds().height),
        visibleOrigin ?? getLauncherWindowState() ?? undefined
      )
      launcherVisibleOrigins.set(launcherWindow, {
        x: nextBounds.x,
        y: nextBounds.y
      })
      setLauncherWindowContentBounds(launcherWindow, nextBounds)
    }
  }

  screen.on("display-metrics-changed", repositionIfVisible)
  screen.on("display-added", repositionIfVisible)
  screen.on("display-removed", repositionIfVisible)

  launcherWindow.on("closed", () => {
    cancelLauncherPresentation(launcherWindow)
    launcherDragController.dispose()
    screen.removeListener("display-metrics-changed", repositionIfVisible)
    screen.removeListener("display-added", repositionIfVisible)
    screen.removeListener("display-removed", repositionIfVisible)
  })

  syncLauncherWindowShape(launcherWindow)
  startRendererWindowLoad(launcherWindow, "launcher", {
    onFailure: observeRendererWindowLoadFailure
  })

  return launcherWindow
}
