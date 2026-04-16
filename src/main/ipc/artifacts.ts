import { BrowserWindow, type IpcMain } from "electron"
import type { ArtifactActionId, ArtifactChangedEvent } from "../../shared/artifacts"
import {
  listArtifacts,
  onArtifactsChanged,
  openArtifact,
  readArtifactFile
} from "../artifacts/service"

let artifactChangeBridgeRegistered = false

export function registerArtifactHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("artifacts:list", async (_event, threadId: string) => {
    return listArtifacts(threadId)
  })

  ipcMain.handle(
    "artifacts:open",
    async (_event, payload: { action?: ArtifactActionId; artifactId: string }) => {
      return openArtifact(payload.artifactId, payload.action)
    }
  )

  ipcMain.handle("artifacts:readFile", async (_event, artifactId: string) => {
    try {
      return {
        success: true,
        ...(await readArtifactFile(artifactId, "text"))
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      }
    }
  })

  ipcMain.handle("artifacts:readBinaryFile", async (_event, artifactId: string) => {
    try {
      return {
        success: true,
        ...(await readArtifactFile(artifactId, "binary"))
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      }
    }
  })

  if (!artifactChangeBridgeRegistered) {
    onArtifactsChanged((payload: ArtifactChangedEvent) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("artifacts:changed", payload)
        }
      }
    })
    artifactChangeBridgeRegistered = true
  }
}
