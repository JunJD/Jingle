import type { IpcMain } from "electron"
import type { ThreadHistoryState, ThreadUpdateParams, Todo, HITLRequest } from "../types"
import { ThreadsService } from "./service"

export class ThreadsController {
  constructor(private readonly threadsService: ThreadsService) {}

  register(ipcMain: IpcMain): void {
    ipcMain.handle("threads:list", async () => {
      return this.threadsService.list()
    })

    ipcMain.handle("threads:get", async (_event, threadId: string) => {
      return this.threadsService.get(threadId)
    })

    ipcMain.handle("threads:create", async (_event, metadata?: Record<string, unknown>) => {
      return this.threadsService.create(metadata)
    })

    ipcMain.handle("threads:update", async (_event, params: ThreadUpdateParams) => {
      return this.threadsService.update(params)
    })

    ipcMain.handle("threads:clone", async (_event, sourceThreadId: string) => {
      return this.threadsService.clone(sourceThreadId)
    })

    ipcMain.handle("threads:delete", async (_event, threadId: string) => {
      await this.threadsService.delete(threadId)
    })

    ipcMain.handle(
      "threads:history",
      async (_event, threadId: string): Promise<ThreadHistoryState> => {
        return this.threadsService.getHistory(threadId)
      }
    )

    ipcMain.handle(
      "threads:runtimeState",
      async (
        _event,
        threadId: string
      ): Promise<{ pendingApproval: HITLRequest | null; todos: Todo[] }> => {
        return this.threadsService.getRuntimeState(threadId)
      }
    )

    ipcMain.handle("threads:generateTitle", async (_event, message: string) => {
      return this.threadsService.generateTitle(message)
    })
  }
}
