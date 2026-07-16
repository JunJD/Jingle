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
  windowSize: {
    height: number
    width: number
  }
}

interface PendingLauncherDragActivation {
  timer: ReturnType<typeof setTimeout>
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
  const webContents = launcherWindow.webContents
  let dragSession: LauncherDragSession | null = null
  let disposed = false
  let pendingDragActivation: PendingLauncherDragActivation | null = null
  let pendingDragStartToken = 0

  const clearPendingDragActivation = (): void => {
    const activation = pendingDragActivation
    if (!activation) {
      return
    }

    clearTimeout(activation.timer)
    pendingDragActivation = null
  }

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
    const snapBounds = resolveLauncherSnapBounds({
      currentBounds: rawBounds,
      guideBounds: session.guideBounds
    })
    const nextBounds = snapBounds ?? rawBounds

    if (!hasBoundsChanged(session.lastBounds, nextBounds)) {
      return
    }

    setContentBounds(nextBounds)
    session.lastBounds = nextBounds
  }

  const stopDrag = (shouldPersist: boolean): void => {
    const session = dragSession
    pendingDragStartToken += 1
    clearPendingDragActivation()
    hideLauncherSnapOverlay()
    if (!session) {
      return
    }

    updateDragPosition()
    clearInterval(session.interval)
    dragSession = null

    if (shouldPersist && !launcherWindow.isDestroyed()) {
      persistOrigin()
    }
  }

  const startDrag = (): void => {
    if (disposed || dragSession || launcherWindow.isDestroyed()) {
      return
    }

    const startBounds = launcherWindow.getContentBounds()
    const guideBounds = getGuideBounds()
    const cursor = screen.getCursorScreenPoint()
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
      windowSize: {
        height: startBounds.height,
        width: startBounds.width
      }
    }

    dragSession = session
    showLauncherSnapOverlay({
      displayBounds: session.displayBounds,
      guideBounds: session.guideBounds
    })
    updateDragPosition()
  }

  const scheduleDragActivation = (token: number): void => {
    clearPendingDragActivation()
    const activation: PendingLauncherDragActivation = {
      timer: setTimeout(() => {
        if (pendingDragStartToken !== token || pendingDragActivation !== activation) {
          return
        }

        pendingDragActivation = null
        startDrag()
      }, LAUNCHER_SNAP_GUIDE_DELAY_MS)
    }
    pendingDragActivation = activation
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

    if (pendingDragActivation) {
      event.preventDefault()

      if (isMouseUp(mouse)) {
        pendingDragStartToken += 1
        clearPendingDragActivation()
      }

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
    void isMouseInLauncherDragRegion(webContents, mouse)
      .then((isDraggable) => {
        if (isDraggable && pendingDragStartToken === dragStartToken) {
          scheduleDragActivation(dragStartToken)
        }
      })
      .catch((error: unknown) => {
        console.warn("[launcher] failed to resolve drag region", error)
      })
  }

  webContents.on("before-mouse-event", handleBeforeMouseEvent)

  return {
    cancel: () => {
      stopDrag(true)
    },
    dispose: () => {
      disposed = true
      if (!webContents.isDestroyed()) {
        webContents.removeListener("before-mouse-event", handleBeforeMouseEvent)
      }
      stopDrag(false)
    },
    isDragging: () => dragSession !== null
  }
}
