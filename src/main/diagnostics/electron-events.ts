import { app, dialog, type BrowserWindow } from "electron"
import type {
  AppWindowKind,
  RendererWindowLoadFailureObserver
} from "../windows/load-renderer-window"
import {
  captureElectronFailure,
  createFatalDiagnosticSingleFlight,
  exitAfterFatalErrorPresentation
} from "./electron-failure"
import { diagnosticsGraph, diagnosticsLogger } from "./instance"
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
  captureElectronFailure(diagnosticsGraph, {
    error,
    kind: "main-process-fatal",
    origin
  })
  const legacyWrite = diagnosticsLogger.errorAndFlush(message, {
    error: serializeProcessError(error),
    eventCode: "process.fatal_error",
    fingerprint: `process.fatal_error:${origin}`,
    origin,
    recoverable: false,
    stateImpact: "process_terminating"
  })
  return Promise.allSettled([legacyWrite, diagnosticsGraph.flush()]).then(() => undefined)
}

async function quitAfterFatalMainProcessError(
  error: unknown,
  diagnosticWrite: Promise<void>
): Promise<void> {
  await waitForFatalDiagnostic(diagnosticWrite)
  exitAfterFatalErrorPresentation(
    () =>
      dialog.showErrorBox(
        "Jingle encountered an unrecoverable error",
        formatFatalMainProcessError(error, diagnosticsLogger.getLogFilePath())
      ),
    (code) => app.exit(code)
  )
}

export function installProcessDiagnostics(options: ProcessDiagnosticsOptions = {}): void {
  const recordFatalOnce = createFatalDiagnosticSingleFlight(recordFatalMainProcessError)

  process.on("uncaughtExceptionMonitor", (error, origin) => {
    void recordFatalOnce("Main process uncaught exception", error, origin).catch(() => undefined)
  })

  if (options.handleFatalErrors) {
    process.on("uncaughtException", (error, origin) => {
      void quitAfterFatalMainProcessError(
        error,
        recordFatalOnce("Main process fatal error", error, origin)
      )
    })

    process.on("unhandledRejection", (reason) => {
      const error = errorFromUnhandledRejection(reason)
      void quitAfterFatalMainProcessError(
        error,
        recordFatalOnce("Main process fatal error", error, "unhandledRejection")
      )
    })
  } else {
    process.on("unhandledRejection", (reason) => {
      const error = errorFromUnhandledRejection(reason)
      void recordFatalOnce("Main process unhandled rejection", error, "unhandledRejection").catch(
        () => undefined
      )
      throw error
    })
  }

  app.on("child-process-gone", (_event, details) => {
    captureElectronFailure(diagnosticsGraph, {
      exitCode: details.exitCode,
      kind: "child-process-gone",
      processType: details.type,
      reason: details.reason
    })
    diagnosticsLogger.error("Electron child process gone", details)
  })
}

export function attachWindowDiagnostics(
  browserWindow: BrowserWindow,
  windowKind: AppWindowKind
): RendererWindowLoadFailureObserver {
  return attachWindowDiagnosticsWithLogger(
    browserWindow,
    windowKind,
    diagnosticsLogger,
    diagnosticsGraph
  )
}
