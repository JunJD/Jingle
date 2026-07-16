export { diagnosticsGraph, diagnosticsLogger, startDiagnosticsSession } from "./instance"
export { attachWindowDiagnostics, installProcessDiagnostics } from "./electron-events"
export { registerDiagnosticsIpcHandlers } from "./controller"
export { normalizeRendererErrorReport } from "./renderer-report"
export { DiagnosticsGraphRecorder } from "./graph"
export { DiagnosticsLogger } from "./logger"
export type {
  DiagnosticEventRef,
  DiagnosticGraphEvent,
  DiagnosticGraphEventInput,
  DiagnosticGraphSink
} from "./schema"
