import { BrowserWindow, type IpcMain } from "electron"
import type { ArtifactActionId, ArtifactChangedEvent } from "../../shared/artifacts"
import { registerIpcHandle } from "../ipc/handle"
import { ArtifactsService } from "./service"

export class ArtifactsController {
  constructor(private readonly artifactsService: ArtifactsService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "artifacts:list", async (_event, threadId: string) => {
      return this.artifactsService.list(threadId)
    })

    registerIpcHandle(
      ipcMain,
      "artifacts:open",
      async (_event, payload: { action?: ArtifactActionId; artifactId: string }) => {
        return this.artifactsService.open(payload.artifactId, payload.action)
      }
    )

    registerIpcHandle(ipcMain, "artifacts:readFile", async (_event, artifactId: string) => {
      return this.artifactsService.readFile(artifactId)
    })

    registerIpcHandle(ipcMain, "artifacts:readBinaryFile", async (_event, artifactId: string) => {
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
