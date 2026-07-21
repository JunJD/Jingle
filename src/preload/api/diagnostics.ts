import {
  diagnosticSupportPacketExportResultSchema,
  type DiagnosticRendererErrorReport,
  type DiagnosticSupportPacketExportResult
} from "@shared/diagnostics"
import { invokeIpc } from "../ipc"

export const diagnosticsApi = {
  exportSupportPacket: async (): Promise<DiagnosticSupportPacketExportResult> =>
    diagnosticSupportPacketExportResultSchema.parse(
      await invokeIpc("diagnostics:exportSupportPacket")
    ),
  reportRendererError(report: DiagnosticRendererErrorReport): Promise<void> {
    return invokeIpc("diagnostics:reportRendererError", report)
  }
}
