import {
  BrowserWindow,
  screen,
  type MouseInputEvent,
  type Rectangle,
  type WebContents
} from "electron"
import { resolveLauncherSnapBounds } from "./launcher-snap-geometry"
import { hideLauncherSnapOverlay, showLauncherSnapOverlay } from "./launcher-snap-overlay"

const LAUNCHER_DRAG_REGION_SELECTOR = ".launcher-window-drag-region"
const LAUNCHER_DRAG_EXCLUDE_SELECTOR =
  'button,input,select,textarea,a,[role="button"],[tabindex]:not([tabindex="-1"]),[contenteditable="true"]'
const LAUNCHER_DRAG_FRAME_MS = 1000 / 60
const LAUNCHER_SNAP_GUIDE_DELAY_MS = 500

interface LauncherDragSession {
  cursorOffset: {
    x: number
    y: number
  }
  displayBounds: Rectangle
  guideBounds: Rectangle
  interval: ReturnType<typeof setInterval>
  lastBounds: Rectangle
  snapGuideTimer: ReturnType<typeof setTimeout>
  snapGuideVisible: boolean
  windowSize: {
    height: number
    width: number
  }
}

export interface LauncherWindowDragController {
  cancel: () => void
  dispose: () => void
  isDragging: () => boolean
}

function isLeftMouseDown(mouse: MouseInputEvent): boolean {
  return mouse.type === "mouseDown" && mouse.button === "left"
}

function isMouseUp(mouse: MouseInputEvent): boolean {
  return mouse.type === "mouseUp"
}

function getEventScreenPoint(mouse: MouseInputEvent): { x: number; y: number } {
  const { globalX, globalY } = mouse
  if (
    typeof globalX === "number" &&
    typeof globalY === "number" &&
    Number.isFinite(globalX) &&
    Number.isFinite(globalY)
  ) {
    return {
      x: Math.round(globalX),
      y: Math.round(globalY)
    }
  }

  return screen.getCursorScreenPoint()
}

function hasBoundsChanged(left: Rectangle, right: Rectangle): boolean {
  return (
    left.x !== right.x ||
    left.y !== right.y ||
    left.width !== right.width ||
    left.height !== right.height
  )
}

async function isMouseInLauncherDragRegion(
  webContents: WebContents,
  mouse: MouseInputEvent
): Promise<boolean> {
  const x = Math.round(mouse.x)
  const y = Math.round(mouse.y)
  const dragRegionSelector = JSON.stringify(LAUNCHER_DRAG_REGION_SELECTOR)
  const excludeSelector = JSON.stringify(LAUNCHER_DRAG_EXCLUDE_SELECTOR)

  return Boolean(
    await webContents.executeJavaScript(
      `(() => {
        const target = document.elementFromPoint(${x}, ${y});
        return Boolean(
          target?.closest(${dragRegionSelector}) &&
          !target.closest(${excludeSelector})
        );
      })()`
    )
  )
}

export function attachLauncherWindowDragController(params: {
  getGuideBounds: () => Rectangle
  launcherWindow: BrowserWindow
  persistOrigin: () => void
  setContentBounds: (bounds: Rectangle) => void
}): LauncherWindowDragController {
  const { getGuideBounds, launcherWindow, persistOrigin, setContentBounds } = params
  let dragSession: LauncherDragSession | null = null
  let disposed = false
  let pendingDragStartToken = 0

  const updateDragPosition = (): void => {
    const session = dragSession
    if (!session || launcherWindow.isDestroyed()) {
      return
    }

    const cursor = screen.getCursorScreenPoint()
    const rawBounds: Rectangle = {
      height: session.windowSize.height,
      width: session.windowSize.width,
      x: Math.round(cursor.x - session.cursorOffset.x),
      y: Math.round(cursor.y - session.cursorOffset.y)
    }
    const snapBounds = session.snapGuideVisible
      ? resolveLauncherSnapBounds({
          currentBounds: rawBounds,
          guideBounds: session.guideBounds
        })
      : null
    const nextBounds = snapBounds ?? rawBounds

    if (!hasBoundsChanged(session.lastBounds, nextBounds)) {
      return
    }

    setContentBounds(nextBounds)
    session.lastBounds = nextBounds
  }

  const showSnapGuide = (session: LauncherDragSession): void => {
    if (launcherWindow.isDestroyed() || dragSession !== session || session.snapGuideVisible) {
      return
    }

    session.snapGuideVisible = true
    showLauncherSnapOverlay({
      displayBounds: session.displayBounds,
      guideBounds: session.guideBounds
    })
    updateDragPosition()
  }

  const stopDrag = (shouldPersist: boolean): void => {
    const session = dragSession
    pendingDragStartToken += 1
    if (!session) {
      return
    }

    updateDragPosition()
    clearInterval(session.interval)
    clearTimeout(session.snapGuideTimer)
    dragSession = null
    hideLauncherSnapOverlay()

    if (shouldPersist && !launcherWindow.isDestroyed()) {
      persistOrigin()
    }
  }

  const startDrag = (mouse: MouseInputEvent): void => {
    if (disposed || dragSession || launcherWindow.isDestroyed()) {
      return
    }

    const startBounds = launcherWindow.getContentBounds()
    const guideBounds = getGuideBounds()
    const cursor = getEventScreenPoint(mouse)
    const display = screen.getDisplayMatching(guideBounds)
    const session: LauncherDragSession = {
      cursorOffset: {
        x: cursor.x - startBounds.x,
        y: cursor.y - startBounds.y
      },
      displayBounds: display.bounds,
      guideBounds,
      interval: setInterval(updateDragPosition, LAUNCHER_DRAG_FRAME_MS),
      lastBounds: startBounds,
      snapGuideTimer: setTimeout(() => showSnapGuide(session), LAUNCHER_SNAP_GUIDE_DELAY_MS),
      snapGuideVisible: false,
      windowSize: {
        height: startBounds.height,
        width: startBounds.width
      }
    }

    dragSession = session
    updateDragPosition()
  }

  const handleBeforeMouseEvent = (event: Electron.Event, mouse: MouseInputEvent): void => {
    if (dragSession) {
      if (mouse.type === "mouseMove") {
        event.preventDefault()
        return
      }

      if (isMouseUp(mouse)) {
        event.preventDefault()
        stopDrag(true)
        return
      }

      event.preventDefault()
      return
    }

    if (isMouseUp(mouse)) {
      pendingDragStartToken += 1
      return
    }

    if (!isLeftMouseDown(mouse)) {
      return
    }

    const dragStartToken = pendingDragStartToken + 1
    pendingDragStartToken = dragStartToken
    void isMouseInLauncherDragRegion(launcherWindow.webContents, mouse)
      .then((isDraggable) => {
        if (isDraggable && pendingDragStartToken === dragStartToken) {
          startDrag(mouse)
        }
      })
      .catch((error: unknown) => {
        console.warn("[launcher] failed to resolve drag region", error)
      })
  }

  launcherWindow.webContents.on("before-mouse-event", handleBeforeMouseEvent)

  return {
    cancel: () => {
      stopDrag(true)
    },
    dispose: () => {
      disposed = true
      launcherWindow.webContents.removeListener("before-mouse-event", handleBeforeMouseEvent)
      stopDrag(false)
    },
    isDragging: () => dragSession !== null
  }
}
