import {
  app,
  dialog,
  type BrowserWindow,
  type Event,
  type RenderProcessGoneDetails,
  type WebContentsConsoleMessageEventParams
} from "electron"
import type { AppWindowKind } from "../windows/load-renderer-window"
import { diagnosticsLogger } from "./instance"
import {
  errorFromUnhandledRejection,
  formatFatalMainProcessError,
  serializeProcessError
} from "./process-errors"

interface ProcessDiagnosticsOptions {
  handleFatalErrors?: boolean
}

function quitAfterFatalMainProcessError(error: unknown, origin: string): void {
  diagnosticsLogger.errorSync("Main process fatal error", {
    error: serializeProcessError(error),
    origin
  })
  dialog.showErrorBox(
    "Jingle encountered an unrecoverable error",
    formatFatalMainProcessError(error, diagnosticsLogger.getLogFilePath())
  )
  app.exit(1)
}

export function installProcessDiagnostics(options: ProcessDiagnosticsOptions = {}): void {
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    diagnosticsLogger.errorSync("Main process uncaught exception", {
      error: serializeProcessError(error),
      origin
    })
  })

  if (options.handleFatalErrors) {
    process.on("uncaughtException", (error, origin) => {
      quitAfterFatalMainProcessError(error, origin)
    })

    process.on("unhandledRejection", (reason) => {
      quitAfterFatalMainProcessError(errorFromUnhandledRejection(reason), "unhandledRejection")
    })
  } else {
    process.on("unhandledRejection", (reason) => {
      diagnosticsLogger.errorSync("Main process unhandled rejection", {
        reason: serializeProcessError(reason)
      })
      throw errorFromUnhandledRejection(reason)
    })
  }

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
      ...serializeProcessError(error)
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

  webContents.on("console-message", (details: Event<WebContentsConsoleMessageEventParams>) => {
    if (details.level !== "warning" && details.level !== "error") {
      return
    }

    diagnosticsLogger[details.level === "error" ? "error" : "warn"]("Renderer console message", {
      line: details.lineNumber,
      message: details.message,
      sourceId: details.sourceId,
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
