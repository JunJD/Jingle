import type { BrowserWindow } from "electron"

const FIXED_WINDOW_ZOOM_FACTOR = 1

export function lockFixedWindowZoom(window: BrowserWindow): void {
  const resetZoom = (): void => {
    if (window.isDestroyed()) {
      return
    }

    window.webContents.setZoomFactor(FIXED_WINDOW_ZOOM_FACTOR)
  }

  resetZoom()
  window.webContents.on("did-finish-load", resetZoom)
  window.webContents.on("zoom-changed", (event) => {
    event.preventDefault()
    resetZoom()
  })
}
