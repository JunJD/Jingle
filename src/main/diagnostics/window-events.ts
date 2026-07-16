import type { BrowserWindow, Event, WebContentsConsoleMessageEventParams } from "electron"
import type {
  AppWindowKind,
  RendererWindowLoadFailure,
  RendererWindowLoadFailureObserver
} from "../windows/load-renderer-window"
import type { DiagnosticsLogFields } from "./logger"
import { serializeProcessError } from "./process-errors"

export interface WindowDiagnosticsLogger {
  error: (message: string, fields?: DiagnosticsLogFields) => void
  info: (message: string, fields?: DiagnosticsLogFields) => void
  warn: (message: string, fields?: DiagnosticsLogFields) => void
}

interface WindowDiagnosticIdentity {
  webContentsId: number
  windowId: number
}

function getFailureFields(
  identity: WindowDiagnosticIdentity,
  windowKind: AppWindowKind,
  failure: RendererWindowLoadFailure
): DiagnosticsLogFields {
  const commonFields = {
    windowKind,
    windowId: identity.windowId,
    webContentsId: identity.webContentsId
  }

  switch (failure.phase) {
    case "load":
      return {
        ...commonFields,
        ...(failure.errorCode === undefined ? {} : { errorCode: failure.errorCode }),
        ...(failure.errorDescription === undefined
          ? {}
          : { errorDescription: failure.errorDescription }),
        ...(failure.validatedURL === undefined ? {} : { validatedURL: failure.validatedURL }),
        ...serializeProcessError(failure.error)
      }
    case "preload":
      return {
        ...commonFields,
        preloadPath: failure.preloadPath,
        ...serializeProcessError(failure.error)
      }
    case "renderer-process":
      return {
        ...commonFields,
        ...failure.details
      }
  }
}

function getFailureMessage(failure: RendererWindowLoadFailure): string {
  switch (failure.phase) {
    case "load":
      return "Renderer load failed"
    case "preload":
      return "Preload script failed"
    case "renderer-process":
      return "Renderer process gone"
  }
}

export function attachWindowDiagnosticsWithLogger(
  browserWindow: BrowserWindow,
  windowKind: AppWindowKind,
  logger: WindowDiagnosticsLogger
): RendererWindowLoadFailureObserver {
  const { webContents } = browserWindow
  const identity: WindowDiagnosticIdentity = {
    webContentsId: webContents.id,
    windowId: browserWindow.id
  }

  logger.info("Window created", {
    windowKind,
    ...identity
  })

  webContents.on("did-finish-load", () => {
    logger.info("Renderer load finished", {
      url: webContents.getURL(),
      windowKind,
      ...identity
    })
  })

  webContents.on("console-message", (details: Event<WebContentsConsoleMessageEventParams>) => {
    if (details.level !== "warning" && details.level !== "error") {
      return
    }

    logger[details.level === "error" ? "error" : "warn"]("Renderer console message", {
      line: details.lineNumber,
      message: details.message,
      sourceId: details.sourceId,
      windowKind,
      ...identity
    })
  })

  browserWindow.on("unresponsive", () => {
    logger.error("Window became unresponsive", {
      windowKind,
      ...identity
    })
  })

  browserWindow.on("responsive", () => {
    logger.info("Window became responsive", {
      windowKind,
      ...identity
    })
  })

  return (failure) => {
    logger.error(getFailureMessage(failure), getFailureFields(identity, windowKind, failure))
  }
}
