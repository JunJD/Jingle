import type { IpcMain } from "electron"
import type { WorkspaceFileParams, WorkspaceSetParams } from "../types"
import { WorkspaceService } from "./service"

export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  register(ipcMain: IpcMain): void {
    ipcMain.handle("workspace:get", async (_event, threadId?: string) => {
      return this.workspaceService.getWorkspacePath(threadId)
    })

    ipcMain.handle("workspace:set", async (_event, params: WorkspaceSetParams) => {
      return this.workspaceService.setWorkspacePath(params)
    })

    ipcMain.handle("workspace:select", async (_event, threadId?: string) => {
      return this.workspaceService.selectWorkspace(threadId)
    })

    ipcMain.handle("workspace:readFile", async (_event, params: WorkspaceFileParams) => {
      return this.workspaceService.readFile(params)
    })

    ipcMain.handle("workspace:readBinaryFile", async (_event, params: WorkspaceFileParams) => {
      return this.workspaceService.readBinaryFile(params)
    })
  }
}
