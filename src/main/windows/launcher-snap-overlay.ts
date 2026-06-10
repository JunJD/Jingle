import { BrowserWindow, type Rectangle } from "electron"
import { join } from "path"
import { getLauncherSnapGuideLines, type LauncherSnapGuideLines } from "./launcher-snap-geometry"

const MAC_SNAP_OVERLAY_WINDOW_LEVEL = "floating"

let snapOverlayWindow: BrowserWindow | null = null
let snapOverlayReady = false
let pendingGuideLines: LauncherSnapGuideLines | null = null

function getSnapOverlayPath(): string {
  return join(__dirname, "../../resources/launcher-snap-overlay.html")
}

function applyPendingGuideLines(): void {
  const overlayWindow = snapOverlayWindow
  if (!overlayWindow || overlayWindow.isDestroyed() || !snapOverlayReady || !pendingGuideLines) {
    return
  }

  const guideLines = pendingGuideLines
  void overlayWindow.webContents
    .executeJavaScript(`window.setLauncherSnapGuide(${JSON.stringify(guideLines)})`)
    .catch((error: unknown) => {
      console.warn("[launcher] failed to update snap overlay", error)
    })
}

function getSnapOverlayWindow(): BrowserWindow {
  if (snapOverlayWindow && !snapOverlayWindow.isDestroyed()) {
    return snapOverlayWindow
  }

  snapOverlayReady = false
  pendingGuideLines = null
  snapOverlayWindow = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    enableLargerThanScreen: true,
    webPreferences: {
      sandbox: true
    }
  })
  snapOverlayWindow.setIgnoreMouseEvents(true, { forward: true })
  snapOverlayWindow.webContents.on("did-finish-load", () => {
    snapOverlayReady = true
    applyPendingGuideLines()
  })
  snapOverlayWindow.on("closed", () => {
    snapOverlayWindow = null
    snapOverlayReady = false
    pendingGuideLines = null
  })
  void snapOverlayWindow.loadFile(getSnapOverlayPath())

  return snapOverlayWindow
}

export function showLauncherSnapOverlay(params: {
  displayBounds: Rectangle
  guideBounds: Rectangle
}): void {
  const overlayWindow = getSnapOverlayWindow()
  const guideLines = getLauncherSnapGuideLines(params)

  pendingGuideLines = guideLines
  overlayWindow.setBounds(params.displayBounds, false)
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })

  if (process.platform === "darwin") {
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    overlayWindow.setAlwaysOnTop(true, MAC_SNAP_OVERLAY_WINDOW_LEVEL)
  } else {
    overlayWindow.setAlwaysOnTop(true)
  }

  overlayWindow.showInactive()
  applyPendingGuideLines()
}

export function hideLauncherSnapOverlay(): void {
  const overlayWindow = snapOverlayWindow
  pendingGuideLines = null
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return
  }

  overlayWindow.hide()
}
