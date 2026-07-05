import type { DiagnosticRendererErrorReport } from "@shared/diagnostics"
import { invokeIpc } from "../ipc"

export const diagnosticsApi = {
  reportRendererError(report: DiagnosticRendererErrorReport): Promise<void> {
    return invokeIpc("diagnostics:reportRendererError", report)
  }
}
