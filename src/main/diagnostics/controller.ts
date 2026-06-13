import type { IpcMain } from "electron"
import { registerIpcHandle } from "../ipc/handle"
import { diagnosticsLogger } from "./instance"
import { normalizeRendererErrorReport } from "./renderer-report"

export function registerDiagnosticsIpcHandlers(ipcMain: IpcMain): void {
  registerIpcHandle(ipcMain, "diagnostics:reportRendererError", (_event, report) => {
    const normalizedReport = normalizeRendererErrorReport(report)
    diagnosticsLogger.error("Renderer reported error", normalizedReport)
  })
}
