import type { IpcMain } from "electron"
import type { AddProjectParams, BindThreadProjectParams } from "@shared/thread-workspace"
import { registerIpcHandle } from "../ipc/handle"
import { ThreadWorkspaceService } from "./service"

export class ThreadWorkspaceController {
  constructor(private readonly service: ThreadWorkspaceService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(
      ipcMain,
      "threadWorkspace:addProject",
      async (_event, params: AddProjectParams) => {
        return this.service.addProject(params.workspacePath)
      }
    )

    registerIpcHandle(
      ipcMain,
      "threadWorkspace:bindProject",
      async (_event, params: BindThreadProjectParams) => {
        return this.service.bindProject(params.threadId, params.workspacePath)
      }
    )

    registerIpcHandle(ipcMain, "threadWorkspace:get", async (_event, threadId: string) => {
      return this.service.get(threadId)
    })

    registerIpcHandle(ipcMain, "threadWorkspace:markProjectless", async (_event, threadId: string) => {
      return this.service.markProjectless(threadId)
    })
  }
}
