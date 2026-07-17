import { join } from "path"
import { getJingleHomeDir } from "../storage"
import { DiagnosticsGraphRecorder } from "./graph"
import { DiagnosticsLogger } from "./logger"
import type { DiagnosticEventRef } from "./schema"

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

  diagnosticsSessionEvent ??= diagnosticsGraph.capture({
    component: "diagnostics",
    dimensionEntries: [
      { key: "appVersion", value: diagnosticsSessionContext.appVersion },
      { key: "electronVersion", value: diagnosticsSessionContext.electronVersion },
      { key: "isPackaged", value: diagnosticsSessionContext.isPackaged },
      { key: "platform", value: diagnosticsSessionContext.platform }
    ],
    eventCode: "diagnostics.session_started",
    level: "info",
    operation: "start-session",
    recoverable: true,
    stateImpact: "none",
    summary: "Jingle diagnostics session started"
  })
  return diagnosticsSessionEvent
}
