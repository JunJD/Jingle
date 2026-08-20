import { app, dialog, type BrowserWindow } from "electron"
import type {
  AppWindowKind,
  RendererWindowLoadFailureObserver
} from "../windows/load-renderer-window"
import {
  captureElectronFailure,
  createFatalDiagnosticSingleFlight,
  exitAfterFatalErrorPresentation,
  normalizeElectronChildProcessGoneEvent,
  settleFatalDiagnosticWrites,
  waitForFatalDiagnosticWrite,
  type FatalDiagnosticWriteOutcome
} from "./electron-failure"
import { electronChildProcessFingerprint } from "./electron-child-process-identity"
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

export type NativeHelperDiagnosticIdentity = "minimal-island" | "selection-capture"

const FATAL_DIAGNOSTICS_TIMEOUT_MS = 1_500

// The main process owns this fact at the `before-quit` boundary. Electron may
// report utility/GPU children as killed while that graceful shutdown is in
// progress; no string-based inference belongs in the diagnostics layer.
let electronShutdownStarted = false

export function markElectronShutdownStarted(): void {
  electronShutdownStarted = true
}

function isExpectedElectronShutdown(
  details: ReturnType<typeof normalizeElectronChildProcessGoneEvent>
): boolean {
  return (
    electronShutdownStarted &&
    (details.processType === "utility" || details.processType === "gpu") &&
    (details.reason === "killed" || details.exitCode === 15)
  )
}

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
    const normalized = normalizeElectronChildProcessGoneEvent(details)
    const expectedShutdown = isExpectedElectronShutdown(normalized)
    captureElectronFailure(diagnosticsGraph, {
      exitCode: normalized.exitCode,
      expectedShutdown,
      kind: "child-process-gone",
      name: normalized.name,
      processType: details.type,
      reason: details.reason,
      serviceName: normalized.serviceName
    })
    const log = expectedShutdown
      ? diagnosticsLogger.info.bind(diagnosticsLogger)
      : diagnosticsLogger.error.bind(diagnosticsLogger)
    log(
      expectedShutdown
        ? "Electron child process exited during application shutdown"
        : "Electron child process gone",
      {
        ...(normalized.exitCode === undefined ? {} : { exitCode: normalized.exitCode }),
        eventCode: "electron.child_process_gone",
        ...(expectedShutdown ? { expected: true, stateImpact: "expected_shutdown" } : {}),
        fingerprint: electronChildProcessFingerprint(normalized),
        name: normalized.name,
        reason: normalized.reason,
        serviceName: normalized.serviceName,
        type: normalized.processType
      }
    )
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

export function recordNativeHelperStdinFailure(
  helper: NativeHelperDiagnosticIdentity,
  error: unknown
): void {
  captureElectronFailure(diagnosticsGraph, {
    error,
    helper,
    kind: "native-helper-stdin-failed"
  })
  try {
    diagnosticsLogger.error("Native helper stdin transport failed", {
      error: serializeProcessError(error),
      eventCode: "native.helper_stdin_failed",
      fingerprint: `native.helper_stdin_failed:${helper}`,
      recoverable: true,
      serviceName: helper,
      stateImpact: "native_helper_unavailable"
    })
  } catch {
    console.error("[Diagnostics] Failed to record native helper stdin transport failure.")
  }
}

export function recordNativeHelperUnexpectedExit(
  helper: NativeHelperDiagnosticIdentity,
  exitCode: number | null,
  signal: NodeJS.Signals | null
): void {
  captureElectronFailure(diagnosticsGraph, {
    exitCode,
    helper,
    kind: "native-helper-unexpected-exit",
    signal
  })
  try {
    diagnosticsLogger.error("Native helper process exited unexpectedly", {
      exitCode,
      eventCode: "native.helper_unexpected_exit",
      fingerprint: `native.helper_unexpected_exit:${helper}`,
      recoverable: true,
      serviceName: helper,
      signal,
      stateImpact: "native_helper_unavailable"
    })
  } catch {
    console.error("[Diagnostics] Failed to record native helper process exit.")
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
