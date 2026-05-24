import type { IpcMain } from "electron"
import type { WorkspaceFileParams, WorkspaceSetParams } from "../types"
import { registerIpcHandle } from "../ipc/handle"
import { WorkspaceService } from "./service"

export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "workspace:get", async (_event, threadId?: string) => {
      return this.workspaceService.getWorkspacePath(threadId)
    })

    registerIpcHandle(ipcMain, "workspace:set", async (_event, params: WorkspaceSetParams) => {
      return this.workspaceService.setWorkspacePath(params)
    })

    registerIpcHandle(ipcMain, "workspace:select", async (_event, threadId?: string) => {
      return this.workspaceService.selectWorkspace(threadId)
    })

    registerIpcHandle(ipcMain, "workspace:readFile", async (_event, params: WorkspaceFileParams) => {
      return this.workspaceService.readFile(params)
    })

    registerIpcHandle(ipcMain, "workspace:readBinaryFile", async (_event, params: WorkspaceFileParams) => {
      return this.workspaceService.readBinaryFile(params)
    })
  }
}
