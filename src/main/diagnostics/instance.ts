import { app } from "electron"
import { join } from "path"
import { getJingleHomeDir } from "../storage"
import { DiagnosticsGraphRecorder } from "./graph"
import { DiagnosticsLogger } from "./logger"
import type { DiagnosticEventRef } from "./schema"

const jingleHomeDir = getJingleHomeDir()
const diagnosticsLogDir = join(jingleHomeDir, "logs")

export const diagnosticsLogger = new DiagnosticsLogger({
  logDir: diagnosticsLogDir,
  rootDir: jingleHomeDir
})

app.setAppLogsPath(diagnosticsLogger.getLogDir())

export const diagnosticsGraph = new DiagnosticsGraphRecorder({
  logger: diagnosticsLogger,
  processKind: "main"
})

let diagnosticsSessionEvent: DiagnosticEventRef | null = null

export function startDiagnosticsSession(): DiagnosticEventRef {
  diagnosticsSessionEvent ??= diagnosticsGraph.capture({
    component: "diagnostics",
    dimensionEntries: [
      { key: "appVersion", value: app.getVersion() },
      { key: "electronVersion", value: process.versions.electron },
      { key: "isPackaged", value: app.isPackaged },
      { key: "platform", value: process.platform }
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
