import { types } from "node:util"
import type {
  AppWindowKind,
  RendererWindowLoadFailure,
  RendererWindowRecoveryEvent
} from "../windows/load-renderer-window"
import type {
  DiagnosticDimensionInput,
  DiagnosticEventRef,
  DiagnosticGraphSink,
  DiagnosticResourceRef
} from "./schema"

const PROCESS_GONE_REASONS = new Set([
  "abnormal-exit",
  "clean-exit",
  "crashed",
  "integrity-failure",
  "killed",
  "launch-failed",
  "memory-eviction",
  "oom"
])
const RENDERER_RECOVERY_TERMINAL_REASONS = new Set([
  "clean-exit",
  "non-recoverable",
  "recovery-exhausted",
  "recovery-failed"
])
const WINDOW_KINDS = new Set(["ipc-network", "launcher", "main", "settings", "thread-window"])
const CHILD_PROCESS_TYPES = new Map([
  ["GPU", "gpu"],
  ["Pepper Plugin", "pepper-plugin"],
  ["Pepper Plugin Broker", "pepper-plugin-broker"],
  ["Sandbox helper", "sandbox-helper"],
  ["Unknown", "unknown"],
  ["Utility", "utility"],
  ["Zygote", "zygote"]
])
const NATIVE_HELPER_STDIN_ERROR_CODES = new Set(["ECONNRESET", "EPIPE", "ERR_STREAM_DESTROYED"])

type ElectronFailureInput =
  | {
      kind: "child-process-gone"
      exitCode: unknown
      processType: unknown
      reason: unknown
    }
  | {
      error: unknown
      kind: "main-process-fatal"
      origin: unknown
    }
  | {
      error: unknown
      kind: "main-process-shutdown-failed"
    }
  | {
      error: unknown
      helper: "minimal-island" | "selection-capture"
      kind: "native-helper-stdin-failed"
    }
  | {
      errorCode?: unknown
      exitCode?: unknown
      kind: "renderer-window-failure"
      phase: RendererWindowLoadFailure["phase"]
      reason?: unknown
      webContentsId: unknown
      windowId: unknown
      windowKind: AppWindowKind | unknown
    }

export type FatalDiagnosticWriteOutcome = Readonly<{
  kind: "failed" | "partial" | "timed_out" | "written"
}>

type FatalDiagnosticRecorder = (
  message: string,
  error: unknown,
  origin: string
) => Promise<FatalDiagnosticWriteOutcome>

const FAILED_FATAL_DIAGNOSTIC_WRITE = Object.freeze({ kind: "failed" } as const)
const PARTIAL_FATAL_DIAGNOSTIC_WRITE = Object.freeze({ kind: "partial" } as const)
const TIMED_OUT_FATAL_DIAGNOSTIC_WRITE = Object.freeze({ kind: "timed_out" } as const)
const WRITTEN_FATAL_DIAGNOSTIC_WRITE = Object.freeze({ kind: "written" } as const)

export async function settleFatalDiagnosticWrites(
  writes: readonly [Promise<void>, Promise<void>]
): Promise<FatalDiagnosticWriteOutcome> {
  const results = await Promise.allSettled(writes)
  const fulfilled = results.filter((result) => result.status === "fulfilled").length
  if (fulfilled === writes.length) {
    return WRITTEN_FATAL_DIAGNOSTIC_WRITE
  }
  return fulfilled > 0 ? PARTIAL_FATAL_DIAGNOSTIC_WRITE : FAILED_FATAL_DIAGNOSTIC_WRITE
}

export async function waitForFatalDiagnosticWrite(
  write: Promise<FatalDiagnosticWriteOutcome>,
  timeoutMs: number
): Promise<FatalDiagnosticWriteOutcome> {
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      write.catch(() => FAILED_FATAL_DIAGNOSTIC_WRITE),
      new Promise<FatalDiagnosticWriteOutcome>((resolve) => {
        timeout = setTimeout(() => resolve(TIMED_OUT_FATAL_DIAGNOSTIC_WRITE), timeoutMs)
      })
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

interface ElectronRendererRecoveryInput {
  event: RendererWindowRecoveryEvent
  webContentsId: unknown
  windowId: unknown
  windowKind: AppWindowKind | unknown
}

export function createFatalDiagnosticSingleFlight(
  record: FatalDiagnosticRecorder
): FatalDiagnosticRecorder {
  let write: Promise<FatalDiagnosticWriteOutcome> | null = null
  return (message, error, origin) => {
    if (write) {
      return write
    }
    try {
      write = record(message, error, origin)
    } catch {
      write = Promise.resolve(FAILED_FATAL_DIAGNOSTIC_WRITE)
    }
    return write
  }
}

export function exitAfterFatalErrorPresentation(
  present: () => void,
  exit: (code: number) => void
): void {
  try {
    present()
  } catch {
    // Native error presentation is best effort and cannot own process termination.
  }
  exit(1)
}

function normalizeExitCode(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined
}

function normalizeRecoveryAttempt(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0
}

function normalizeRecoveryTerminalReason(value: unknown): string {
  return typeof value === "string" && RENDERER_RECOVERY_TERMINAL_REASONS.has(value)
    ? value
    : "unknown"
}

function normalizeProcessGoneReason(value: unknown): string {
  return typeof value === "string" && PROCESS_GONE_REASONS.has(value) ? value : "unknown"
}

function normalizeWindowKind(value: unknown): string {
  return typeof value === "string" && WINDOW_KINDS.has(value) ? value : "unknown"
}

function normalizeRendererFailurePhase(
  value: unknown
): RendererWindowLoadFailure["phase"] | "unknown" {
  return value === "load" || value === "preload" || value === "renderer-process" ? value : "unknown"
}

function normalizeChildProcessType(value: unknown): string {
  return typeof value === "string" ? (CHILD_PROCESS_TYPES.get(value) ?? "unknown") : "unknown"
}

function normalizeMainProcessOrigin(value: unknown): string {
  return value === "uncaughtException" || value === "unhandledRejection" ? value : "unknown"
}

function readTrustedMainProcessError(value: unknown): Error | null {
  if (!value || typeof value !== "object" || types.isProxy(value)) {
    return null
  }
  try {
    return types.isNativeError(value) ? value : null
  } catch {
    return null
  }
}

function normalizeNativeHelperStdinErrorCode(error: Error | null): string {
  if (!error) {
    return "unknown"
  }
  try {
    const code = Object.getOwnPropertyDescriptor(error, "code")
    return code && "value" in code && NATIVE_HELPER_STDIN_ERROR_CODES.has(code.value)
      ? String(code.value)
      : "unknown"
  } catch {
    return "unknown"
  }
}

function toPositiveIntegerRef(kind: string, value: unknown): DiagnosticResourceRef | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? { id: String(value), kind }
    : null
}

function compactRefs(refs: Array<DiagnosticResourceRef | null>): DiagnosticResourceRef[] {
  return refs.filter((ref): ref is DiagnosticResourceRef => ref !== null)
}

function withOptionalNumber(
  dimensions: DiagnosticDimensionInput[],
  key: string,
  value: unknown
): DiagnosticDimensionInput[] {
  const normalized = normalizeExitCode(value)
  return normalized === undefined ? dimensions : [...dimensions, { key, value: normalized }]
}

function captureMainProcessFailure(
  sink: DiagnosticGraphSink,
  input: Extract<ElectronFailureInput, { kind: "main-process-fatal" }>
): DiagnosticEventRef {
  const origin = normalizeMainProcessOrigin(input.origin)
  const error = readTrustedMainProcessError(input.error)
  return sink.capture({
    component: "electron",
    dimensionEntries: [{ key: "origin", value: origin }],
    eventCode: "process.fatal_error",
    ...(error
      ? {
          evidence: [
            {
              contentType: "application/json",
              kind: "error",
              value: error
            }
          ]
        }
      : {}),
    fingerprint: `process.fatal_error:${origin}`,
    level: "error",
    operation: "observe-main-process",
    recoverable: false,
    refs: [{ id: "main", kind: "process" }],
    stateImpact: "process_terminating",
    summary: "Electron main process encountered a fatal error"
  })
}

function captureMainProcessShutdownFailure(
  sink: DiagnosticGraphSink,
  input: Extract<ElectronFailureInput, { kind: "main-process-shutdown-failed" }>
): DiagnosticEventRef {
  const error = readTrustedMainProcessError(input.error)
  return sink.capture({
    component: "electron",
    eventCode: "process.shutdown_failed",
    ...(error
      ? {
          evidence: [
            {
              contentType: "application/json",
              kind: "error",
              value: error
            }
          ]
        }
      : {}),
    fingerprint: "process.shutdown_failed",
    level: "error",
    operation: "shutdown-main-process",
    recoverable: false,
    refs: [{ id: "main", kind: "process" }],
    stateImpact: "shutdown_incomplete",
    summary: "Electron main process shutdown did not complete"
  })
}

function captureChildProcessFailure(
  sink: DiagnosticGraphSink,
  input: Extract<ElectronFailureInput, { kind: "child-process-gone" }>
): DiagnosticEventRef {
  const processType = normalizeChildProcessType(input.processType)
  const reason = normalizeProcessGoneReason(input.reason)
  return sink.capture({
    component: "electron",
    dimensionEntries: withOptionalNumber(
      [
        { key: "processType", value: processType },
        { key: "reason", value: reason }
      ],
      "exitCode",
      input.exitCode
    ),
    eventCode: "electron.child_process_gone",
    fingerprint: `electron.child_process_gone:${processType}:${reason}`,
    level: "error",
    operation: "observe-child-process",
    recoverable: true,
    refs: [{ id: `child:${processType}`, kind: "process" }],
    stateImpact: "child_process_lost",
    summary: "Electron child process exited unexpectedly"
  })
}

function captureNativeHelperStdinFailure(
  sink: DiagnosticGraphSink,
  input: Extract<ElectronFailureInput, { kind: "native-helper-stdin-failed" }>
): DiagnosticEventRef {
  const helper =
    input.helper === "minimal-island" || input.helper === "selection-capture"
      ? input.helper
      : "unknown"
  const error = readTrustedMainProcessError(input.error)
  return sink.capture({
    component: "native",
    dimensionEntries: [
      { key: "errorCode", value: normalizeNativeHelperStdinErrorCode(error) },
      { key: "helper", value: helper }
    ],
    eventCode: "native.helper_stdin_failed",
    fingerprint: `native.helper_stdin_failed:${helper}`,
    level: "error",
    operation: "write-helper-stdin",
    recoverable: true,
    refs: [{ id: helper, kind: "native-helper" }],
    stateImpact: "native_helper_unavailable",
    summary: "Native helper stdin transport failed"
  })
}

function captureRendererWindowFailure(
  sink: DiagnosticGraphSink,
  input: Extract<ElectronFailureInput, { kind: "renderer-window-failure" }>
): DiagnosticEventRef {
  const windowKind = normalizeWindowKind(input.windowKind)
  const phase = normalizeRendererFailurePhase(input.phase)
  const commonDimensions: DiagnosticDimensionInput[] = [
    { key: "phase", value: phase },
    { key: "windowKind", value: windowKind }
  ]
  const refs = compactRefs([
    toPositiveIntegerRef("window", input.windowId),
    toPositiveIntegerRef("web-contents", input.webContentsId)
  ])

  if (phase === "renderer-process") {
    const reason = normalizeProcessGoneReason(input.reason)
    return sink.capture({
      component: "electron",
      dimensionEntries: withOptionalNumber(
        [...commonDimensions, { key: "reason", value: reason }],
        "exitCode",
        input.exitCode
      ),
      eventCode: "electron.renderer_process_gone",
      fingerprint: `electron.renderer_process_gone:${windowKind}:${reason}`,
      level: "error",
      operation: "observe-renderer-process",
      recoverable: true,
      refs,
      stateImpact: "window_terminated",
      summary: "Electron renderer process exited unexpectedly"
    })
  }

  const eventCode =
    phase === "preload"
      ? "electron.preload_failed"
      : phase === "load"
        ? "electron.renderer_load_failed"
        : "electron.renderer_failure"
  return sink.capture({
    component: "electron",
    dimensionEntries:
      phase === "load"
        ? withOptionalNumber(commonDimensions, "errorCode", input.errorCode)
        : commonDimensions,
    eventCode,
    fingerprint: `${eventCode}:${windowKind}`,
    level: "error",
    operation:
      phase === "preload" ? "load-preload" : phase === "load" ? "load-renderer" : "observe",
    recoverable: true,
    refs,
    stateImpact: "window_terminated",
    summary:
      phase === "preload"
        ? "Electron preload script failed"
        : phase === "load"
          ? "Electron renderer failed to load"
          : "Electron renderer failed"
  })
}

export function captureElectronRendererRecovery(
  sink: DiagnosticGraphSink,
  input: ElectronRendererRecoveryInput
): DiagnosticEventRef | undefined {
  try {
    const { event } = input
    const windowKind = normalizeWindowKind(input.windowKind)
    const refs = compactRefs([
      toPositiveIntegerRef("window", input.windowId),
      toPositiveIntegerRef("web-contents", input.webContentsId)
    ])
    const common = {
      component: "electron",
      parentEvents: event.parentEvents,
      refs
    } as const

    switch (event.kind) {
      case "started":
        return sink.capture({
          ...common,
          dimensionEntries: [
            { key: "attempt", value: normalizeRecoveryAttempt(event.attempt) },
            { key: "windowKind", value: windowKind }
          ],
          eventCode: "electron.renderer_recovery_started",
          fingerprint: `electron.renderer_recovery_started:${windowKind}`,
          level: "warn",
          operation: "recover-renderer",
          recoverable: true,
          stateImpact: "window_recovery_started",
          summary: "Electron renderer recovery started"
        })
      case "succeeded":
        return sink.capture({
          ...common,
          dimensionEntries: [
            { key: "attempt", value: normalizeRecoveryAttempt(event.attempt) },
            { key: "windowKind", value: windowKind }
          ],
          eventCode: "electron.renderer_recovery_succeeded",
          fingerprint: `electron.renderer_recovery_succeeded:${windowKind}`,
          level: "info",
          operation: "recover-renderer",
          recoverable: true,
          stateImpact: "window_recovered",
          summary: "Electron renderer recovery succeeded"
        })
      case "exhausted": {
        const terminalReason = normalizeRecoveryTerminalReason(event.terminalReason)
        return sink.capture({
          ...common,
          dimensionEntries: [
            { key: "attempt", value: normalizeRecoveryAttempt(event.attempt) },
            { key: "terminalReason", value: terminalReason },
            { key: "windowKind", value: windowKind }
          ],
          eventCode: "electron.renderer_recovery_exhausted",
          fingerprint: `electron.renderer_recovery_exhausted:${windowKind}:${terminalReason}`,
          level: "error",
          operation: "recover-renderer",
          recoverable: false,
          stateImpact: "window_terminated",
          summary: "Electron renderer recovery was exhausted"
        })
      }
    }
  } catch {
    return undefined
  }
}

export function captureElectronFailure(
  sink: DiagnosticGraphSink,
  input: ElectronFailureInput
): DiagnosticEventRef | undefined {
  try {
    switch (input.kind) {
      case "main-process-fatal":
        return captureMainProcessFailure(sink, input)
      case "main-process-shutdown-failed":
        return captureMainProcessShutdownFailure(sink, input)
      case "native-helper-stdin-failed":
        return captureNativeHelperStdinFailure(sink, input)
      case "child-process-gone":
        return captureChildProcessFailure(sink, input)
      case "renderer-window-failure":
        return captureRendererWindowFailure(sink, input)
    }
  } catch {
    return undefined
  }
}
