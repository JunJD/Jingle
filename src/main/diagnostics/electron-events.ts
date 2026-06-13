import { app, type BrowserWindow, type RenderProcessGoneDetails } from "electron"
import type { AppWindowKind } from "../windows/load-renderer-window"
import { diagnosticsLogger } from "./instance"

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    }
  }

  return {
    message: String(error)
  }
}

export function installProcessDiagnostics(): void {
  process.on("uncaughtExceptionMonitor", (error) => {
    diagnosticsLogger.error("Main process uncaught exception", serializeError(error))
  })

  process.on("unhandledRejection", (reason) => {
    diagnosticsLogger.error("Main process unhandled rejection", {
      reason: serializeError(reason)
    })
  })

  app.on("child-process-gone", (_event, details) => {
    diagnosticsLogger.error("Electron child process gone", details)
  })
}

export function attachWindowDiagnostics(
  browserWindow: BrowserWindow,
  windowKind: AppWindowKind
): void {
  const { webContents } = browserWindow

  diagnosticsLogger.info("Window created", {
    windowKind,
    windowId: browserWindow.id,
    webContentsId: webContents.id
  })

  webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    diagnosticsLogger.error("Renderer load failed", {
      errorCode,
      errorDescription,
      validatedURL,
      windowKind,
      windowId: browserWindow.id,
      webContentsId: webContents.id
    })
  })

  webContents.on("did-finish-load", () => {
    diagnosticsLogger.info("Renderer load finished", {
      url: webContents.getURL(),
      windowKind,
      windowId: browserWindow.id,
      webContentsId: webContents.id
    })
  })

  webContents.on("preload-error", (_event, preloadPath, error) => {
    diagnosticsLogger.error("Preload script failed", {
      preloadPath,
      windowKind,
      windowId: browserWindow.id,
      webContentsId: webContents.id,
      ...serializeError(error)
    })
  })

  webContents.on("render-process-gone", (_event, details: RenderProcessGoneDetails) => {
    diagnosticsLogger.error("Renderer process gone", {
      ...details,
      windowKind,
      windowId: browserWindow.id,
      webContentsId: webContents.id
    })
  })

  webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level < 2) {
      return
    }

    diagnosticsLogger[level >= 3 ? "error" : "warn"]("Renderer console message", {
      line,
      message,
      sourceId,
      windowKind,
      windowId: browserWindow.id,
      webContentsId: webContents.id
    })
  })

  browserWindow.on("unresponsive", () => {
    diagnosticsLogger.error("Window became unresponsive", {
      windowKind,
      windowId: browserWindow.id,
      webContentsId: webContents.id
    })
  })

  browserWindow.on("responsive", () => {
    diagnosticsLogger.info("Window became responsive", {
      windowKind,
      windowId: browserWindow.id,
      webContentsId: webContents.id
    })
  })
}
