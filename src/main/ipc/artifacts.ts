import { BrowserWindow, type IpcMain } from "electron"
import type { ArtifactActionId, ArtifactChangedEvent } from "../../shared/artifacts"
import { listArtifacts, onArtifactsChanged, openArtifact } from "../artifacts/service"

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
