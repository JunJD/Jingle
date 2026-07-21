import { BrowserWindow, dialog, type IpcMain, type IpcMainInvokeEvent } from "electron"
import { z } from "zod/v4"
import type { DiagnosticSupportPacketExportResult } from "@shared/diagnostics"
import { registerIpcHandle, registerValidatedIpcHandle } from "../ipc/handle"
import { getWindowIdentity, type WindowIdentity } from "../windows/window-identity"
import { diagnosticsGraph, diagnosticsLogger } from "./instance"
import { createRendererErrorDiagnostic, normalizeRendererErrorReport } from "./renderer-report"
import type { DiagnosticGraphSink } from "./schema"
import { readDiagnosticSupportPacketErrorCode } from "./support-packet"

export interface DiagnosticsSupportPacketControllerDependencies {
  exportPacket: (destinationDirectory: string) => Promise<DiagnosticSupportPacketExportResult>
  graph?: DiagnosticGraphSink
  logger?: Pick<typeof diagnosticsLogger, "error">
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

function readRegisteredMainFrameIdentity(event: IpcMainInvokeEvent): WindowIdentity {
  const identity = getWindowIdentity(event.sender)
  if (event.senderFrame !== event.sender.mainFrame || !identity) {
    throw new Error("Renderer diagnostics require a registered window main frame.")
  }
  return identity
}

export function registerDiagnosticsIpcHandlers(
  ipcMain: IpcMain,
  dependencies: DiagnosticsSupportPacketControllerDependencies = defaultSupportPacketDependencies
): void {
  const graph = dependencies.graph ?? diagnosticsGraph
  const logger = dependencies.logger ?? diagnosticsLogger

  registerIpcHandle(ipcMain, "diagnostics:reportRendererError", (event, report) => {
    const identity = readRegisteredMainFrameIdentity(event)
    const normalizedReport = normalizeRendererErrorReport(report, identity.kind)
    try {
      logger.error("Renderer reported error", normalizedReport)
    } catch {
      // The causal recorder remains independent from the legacy local log.
    }
    try {
      graph.capture(createRendererErrorDiagnostic(normalizedReport, identity, event.sender.id))
    } catch {
      // Renderer error reporting is best effort and must not create a rejection loop.
    }
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
