import { app } from "electron"
import { join } from "path"
import { getJingleHomeDir } from "../storage"
import { DiagnosticsLogger } from "./logger"

const diagnosticsLogDir = join(getJingleHomeDir(), "logs")

app.setAppLogsPath(diagnosticsLogDir)

export const diagnosticsLogger = new DiagnosticsLogger({
  logDir: diagnosticsLogDir
})
