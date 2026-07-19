import type { AppWindowKind, RendererWindowLoadFailure } from "../windows/load-renderer-window"
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

type ElectronFailureInput =
  | {
      kind: "child-process-gone"
      exitCode: unknown
      processType: unknown
      reason: unknown
    }
  | {
      kind: "main-process-fatal"
      origin: unknown
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

type FatalDiagnosticRecorder = (message: string, error: unknown, origin: string) => Promise<void>

export function createFatalDiagnosticSingleFlight(
  record: FatalDiagnosticRecorder
): FatalDiagnosticRecorder {
  let write: Promise<void> | null = null
  return (message, error, origin) => {
    write ??= record(message, error, origin)
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
  return sink.capture({
    component: "electron",
    dimensionEntries: [{ key: "origin", value: origin }],
    eventCode: "process.fatal_error",
    fingerprint: `process.fatal_error:${origin}`,
    level: "error",
    operation: "observe-main-process",
    recoverable: false,
    refs: [{ id: "main", kind: "process" }],
    stateImpact: "process_terminating",
    summary: "Electron main process encountered a fatal error"
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

export function captureElectronFailure(
  sink: DiagnosticGraphSink,
  input: ElectronFailureInput
): DiagnosticEventRef | undefined {
  try {
    switch (input.kind) {
      case "main-process-fatal":
        return captureMainProcessFailure(sink, input)
      case "child-process-gone":
        return captureChildProcessFailure(sink, input)
      case "renderer-window-failure":
        return captureRendererWindowFailure(sink, input)
    }
  } catch {
    return undefined
  }
}
