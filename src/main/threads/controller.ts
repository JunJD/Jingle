import type { IpcMain } from "electron"
import type { ThreadHistoryState, ThreadRuntimeState, ThreadUpdateParams } from "../types"
import { registerIpcHandle } from "../ipc/handle"
import { ThreadsService } from "./service"

export class ThreadsController {
  constructor(private readonly threadsService: ThreadsService) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "threads:list", async () => {
      return this.threadsService.list()
    })

    registerIpcHandle(ipcMain, "threads:get", async (_event, threadId: string) => {
      return this.threadsService.get(threadId)
    })

    registerIpcHandle(ipcMain, "threads:create", async (_event, metadata?: Record<string, unknown>) => {
      return this.threadsService.create(metadata)
    })

    registerIpcHandle(ipcMain, "threads:update", async (_event, params: ThreadUpdateParams) => {
      return this.threadsService.update(params)
    })

    registerIpcHandle(ipcMain, "threads:clone", async (_event, sourceThreadId: string) => {
      return this.threadsService.clone(sourceThreadId)
    })

    registerIpcHandle(
      ipcMain,
      "threads:cloneUntilMessage",
      async (_event, sourceThreadId: string, messageId: string) => {
        return this.threadsService.cloneUntilMessage(sourceThreadId, messageId)
      }
    )

    registerIpcHandle(ipcMain, "threads:delete", async (_event, threadId: string) => {
      await this.threadsService.delete(threadId)
    })

    registerIpcHandle(
      ipcMain,
      "threads:history",
      async (_event, threadId: string): Promise<ThreadHistoryState> => {
        return this.threadsService.getHistory(threadId)
      }
    )

    registerIpcHandle(
      ipcMain,
      "threads:runtimeState",
      async (_event, threadId: string): Promise<ThreadRuntimeState> => {
        return this.threadsService.getRuntimeState(threadId)
      }
    )

    registerIpcHandle(ipcMain, "threads:generateTitle", async (_event, message: string) => {
      return this.threadsService.generateTitle(message)
    })
  }
}
