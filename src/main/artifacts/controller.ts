import { BrowserWindow, type IpcMain } from "electron"
import type { ArtifactActionId, ArtifactChangedEvent } from "../../shared/artifacts"
import { ArtifactsService } from "./service"

export class ArtifactsController {
  constructor(private readonly artifactsService: ArtifactsService) {}

  register(ipcMain: IpcMain): void {
    ipcMain.handle("artifacts:list", async (_event, threadId: string) => {
      return this.artifactsService.list(threadId)
    })

    ipcMain.handle(
      "artifacts:open",
      async (_event, payload: { action?: ArtifactActionId; artifactId: string }) => {
        return this.artifactsService.open(payload.artifactId, payload.action)
      }
    )

    ipcMain.handle("artifacts:readFile", async (_event, artifactId: string) => {
      return this.artifactsService.readFile(artifactId)
    })

    ipcMain.handle("artifacts:readBinaryFile", async (_event, artifactId: string) => {
      return this.artifactsService.readBinaryFile(artifactId)
    })

    this.artifactsService.onChanged((payload: ArtifactChangedEvent) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("artifacts:changed", payload)
        }
      }
    })
  }
}
