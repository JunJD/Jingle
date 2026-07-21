import { app, dialog, type BrowserWindow } from "electron"
import type {
  AppWindowKind,
  RendererWindowLoadFailureObserver
} from "../windows/load-renderer-window"
import {
  captureElectronFailure,
  createFatalDiagnosticSingleFlight,
  exitAfterFatalErrorPresentation,
  settleFatalDiagnosticWrites,
  waitForFatalDiagnosticWrite,
  type FatalDiagnosticWriteOutcome
} from "./electron-failure"
import {
  diagnosticsGraph,
  diagnosticsLogger,
  markDiagnosticsSessionJsFatal,
  markDiagnosticsSessionShutdownFailed
} from "./instance"
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

function recordFatalMainProcessError(
  message: string,
  error: unknown,
  origin: string
): Promise<FatalDiagnosticWriteOutcome> {
  markDiagnosticsSessionJsFatal(origin)
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
  return settleFatalDiagnosticWrites([legacyWrite, diagnosticsGraph.flush()])
}

async function quitAfterFatalMainProcessError(
  error: unknown,
  diagnosticWrite: Promise<FatalDiagnosticWriteOutcome>
): Promise<void> {
  const diagnosticWriteOutcome = await waitForFatalDiagnosticWrite(
    diagnosticWrite,
    FATAL_DIAGNOSTICS_TIMEOUT_MS
  )
  exitAfterFatalErrorPresentation(
    () =>
      dialog.showErrorBox(
        "Jingle encountered an unrecoverable error",
        formatFatalMainProcessError(
          error,
          diagnosticsLogger.getLogFilePath(),
          diagnosticWriteOutcome
        )
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

export function recordMainProcessShutdownFailure(error: unknown): void {
  try {
    markDiagnosticsSessionShutdownFailed()
  } catch {
    console.error("[Diagnostics] Failed to mark main process shutdown failure.")
  }
  captureElectronFailure(diagnosticsGraph, {
    error,
    kind: "main-process-shutdown-failed"
  })
  try {
    void diagnosticsLogger
      .errorAndFlush("Main process shutdown failed", {
        error: serializeProcessError(error),
        eventCode: "process.shutdown_failed",
        fingerprint: "process.shutdown_failed",
        recoverable: false,
        stateImpact: "shutdown_incomplete"
      })
      .catch(() => undefined)
  } catch {
    console.error("[Diagnostics] Failed to enqueue main process shutdown failure.")
  }
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
