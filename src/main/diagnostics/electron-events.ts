import { app, dialog, type BrowserWindow } from "electron"
import type {
  AppWindowKind,
  RendererWindowLoadFailureObserver
} from "../windows/load-renderer-window"
import { diagnosticsLogger } from "./instance"
import {
  errorFromUnhandledRejection,
  formatFatalMainProcessError,
  serializeProcessError
} from "./process-errors"
import { attachWindowDiagnosticsWithLogger } from "./window-events"

interface ProcessDiagnosticsOptions {
  handleFatalErrors?: boolean
}

const FATAL_DIAGNOSTICS_TIMEOUT_MS = 1_500

async function waitForFatalDiagnostic(write: Promise<void>): Promise<void> {
  let timeout: NodeJS.Timeout | undefined
  await Promise.race([
    write.catch(() => undefined),
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, FATAL_DIAGNOSTICS_TIMEOUT_MS)
      timeout.unref()
    })
  ])
  if (timeout) {
    clearTimeout(timeout)
  }
}

function recordFatalMainProcessError(
  message: string,
  error: unknown,
  origin: string
): Promise<void> {
  return diagnosticsLogger.errorAndFlush(message, {
    error: serializeProcessError(error),
    eventCode: "process.fatal_error",
    fingerprint: `process.fatal_error:${origin}`,
    origin,
    recoverable: false,
    stateImpact: "process_terminating"
  })
}

async function quitAfterFatalMainProcessError(error: unknown, origin: string): Promise<void> {
  await waitForFatalDiagnostic(
    recordFatalMainProcessError("Main process fatal error", error, origin)
  )
  dialog.showErrorBox(
    "Jingle encountered an unrecoverable error",
    formatFatalMainProcessError(error, diagnosticsLogger.getLogFilePath())
  )
  app.exit(1)
}

export function installProcessDiagnostics(options: ProcessDiagnosticsOptions = {}): void {
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    void recordFatalMainProcessError("Main process uncaught exception", error, origin).catch(
      () => undefined
    )
  })

  if (options.handleFatalErrors) {
    process.on("uncaughtException", (error, origin) => {
      void quitAfterFatalMainProcessError(error, origin)
    })

    process.on("unhandledRejection", (reason) => {
      void quitAfterFatalMainProcessError(errorFromUnhandledRejection(reason), "unhandledRejection")
    })
  } else {
    process.on("unhandledRejection", (reason) => {
      void recordFatalMainProcessError(
        "Main process unhandled rejection",
        reason,
        "unhandledRejection"
      ).catch(() => undefined)
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
): RendererWindowLoadFailureObserver {
  return attachWindowDiagnosticsWithLogger(browserWindow, windowKind, diagnosticsLogger)
}
