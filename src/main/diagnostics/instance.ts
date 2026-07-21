import { join } from "path"
import { getJingleHomeDir } from "../storage"
import { DiagnosticsGraphRecorder } from "./graph"
import { DiagnosticsLogger } from "./logger"
import { DiagnosticsProcessSession } from "./process-session"
import type { DiagnosticEventRef } from "./schema"
import type { DiagnosticSupportPacketRuntimeIdentity } from "./support-packet"

export interface DiagnosticsInitialization {
  appVersion: string
  electronVersion: string
  isPackaged: boolean
  platform: NodeJS.Platform
  setAppLogsPath: (path: string) => void
}

type DiagnosticsSessionContext = Omit<DiagnosticsInitialization, "setAppLogsPath">

const jingleHomeDir = getJingleHomeDir()
const diagnosticsLogDir = join(jingleHomeDir, "logs")

export const diagnosticsLogger = new DiagnosticsLogger({
  logDir: diagnosticsLogDir,
  rootDir: jingleHomeDir
})

export const diagnosticsGraph = new DiagnosticsGraphRecorder({
  logger: diagnosticsLogger,
  processKind: "main"
})

const diagnosticsProcessSession = new DiagnosticsProcessSession({
  logDir: diagnosticsLogDir,
  sink: diagnosticsGraph
})

let diagnosticsSessionContext: DiagnosticsSessionContext | null = null
let diagnosticsSessionEvent: DiagnosticEventRef | null = null

export function initializeDiagnostics(initialization: DiagnosticsInitialization): void {
  if (diagnosticsSessionContext) {
    throw new Error("Diagnostics have already been initialized.")
  }

  initialization.setAppLogsPath(diagnosticsLogger.getLogDir())
  diagnosticsSessionContext = {
    appVersion: initialization.appVersion,
    electronVersion: initialization.electronVersion,
    isPackaged: initialization.isPackaged,
    platform: initialization.platform
  }
}

export function startDiagnosticsSession(): DiagnosticEventRef {
  if (!diagnosticsSessionContext) {
    throw new Error("Diagnostics must be initialized before starting a diagnostics session.")
  }

  diagnosticsSessionEvent ??= diagnosticsProcessSession.start(diagnosticsSessionContext).eventRef
  return diagnosticsSessionEvent
}

export function markDiagnosticsSessionCleanExit(): boolean {
  return diagnosticsProcessSession.markCleanExit({ captureEvent: false })
}

export function markDiagnosticsSessionJsFatal(origin: unknown): boolean {
  return diagnosticsProcessSession.markJsFatal(origin)
}

export function getDiagnosticsSupportPacketRuntimeIdentity(): DiagnosticSupportPacketRuntimeIdentity {
  if (!diagnosticsSessionContext) {
    throw new Error("Diagnostics must be initialized before exporting a support packet.")
  }
  return {
    ...diagnosticsSessionContext,
    sourceRevision: { kind: "unavailable", reason: "not-embedded" }
  }
}
