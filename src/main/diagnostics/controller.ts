import { BrowserWindow, dialog, type IpcMain, type IpcMainInvokeEvent } from "electron"
import { z } from "zod/v4"
import type { DiagnosticSupportPacketExportResult } from "@shared/diagnostics"
import { registerIpcHandle, registerValidatedIpcHandle } from "../ipc/handle"
import { getWindowIdentity } from "../windows/window-identity"
import { diagnosticsLogger } from "./instance"
import { normalizeRendererErrorReport } from "./renderer-report"
import { readDiagnosticSupportPacketErrorCode } from "./support-packet"

export interface DiagnosticsSupportPacketControllerDependencies {
  exportPacket: (destinationDirectory: string) => Promise<DiagnosticSupportPacketExportResult>
  selectDestinationDirectory: (event: IpcMainInvokeEvent) => Promise<string | null>
}

const defaultSupportPacketDependencies: DiagnosticsSupportPacketControllerDependencies = {
  exportPacket: async (destinationDirectory) => {
    const { exportDiagnosticSupportPacket } = await import("./support-packet")
    return exportDiagnosticSupportPacket(destinationDirectory)
  },
  selectDestinationDirectory: async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) {
      throw new Error("Settings window owner is unavailable.")
    }
    const result = await dialog.showOpenDialog(owner, {
      properties: ["openDirectory", "createDirectory"]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }
}

function assertSettingsMainFrame(event: IpcMainInvokeEvent): void {
  if (
    event.senderFrame !== event.sender.mainFrame ||
    getWindowIdentity(event.sender)?.kind !== "settings"
  ) {
    throw new Error("Diagnostic support packets can only be exported by the Settings main frame.")
  }
}

export function registerDiagnosticsIpcHandlers(
  ipcMain: IpcMain,
  dependencies: DiagnosticsSupportPacketControllerDependencies = defaultSupportPacketDependencies
): void {
  registerIpcHandle(ipcMain, "diagnostics:reportRendererError", (_event, report) => {
    const normalizedReport = normalizeRendererErrorReport(report)
    diagnosticsLogger.error("Renderer reported error", normalizedReport)
  })

  registerValidatedIpcHandle(
    ipcMain,
    "diagnostics:exportSupportPacket",
    z.tuple([]),
    async (event): Promise<DiagnosticSupportPacketExportResult> => {
      assertSettingsMainFrame(event)
      let destinationDirectory: string | null
      try {
        destinationDirectory = await dependencies.selectDestinationDirectory(event)
      } catch {
        return { code: "destination_unavailable", kind: "failed" }
      }
      if (!destinationDirectory) return { kind: "cancelled" }
      try {
        return await dependencies.exportPacket(destinationDirectory)
      } catch (error) {
        return { code: readDiagnosticSupportPacketErrorCode(error), kind: "failed" }
      }
    }
  )
}
