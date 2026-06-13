import { app } from "electron"
import { join } from "path"
import { getOpenworkDir } from "../storage"
import { DiagnosticsLogger } from "./logger"

const diagnosticsLogDir = join(getOpenworkDir(), "logs")

app.setAppLogsPath(diagnosticsLogDir)

export const diagnosticsLogger = new DiagnosticsLogger({
  logDir: diagnosticsLogDir
})
