import type { IpcMain } from "electron"
import type { AgentThreadDataSnapshot, CreateThreadInput, ThreadUpdateParams } from "../types"
import { AgentThreadRunner } from "../agent/agent-thread-runner"
import { registerIpcHandle } from "../ipc/handle"
import { ThreadsService } from "./service"

export class ThreadsController {
  constructor(
    private readonly threadsService: ThreadsService,
    private readonly agentThreadRunner: AgentThreadRunner
  ) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "threads:list", async () => {
      return this.threadsService.list()
    })

    registerIpcHandle(ipcMain, "threads:get", async (_event, threadId: string) => {
      return this.threadsService.get(threadId)
    })

    registerIpcHandle(
      ipcMain,
      "threads:create",
      async (_event, input?: CreateThreadInput) => {
        return this.threadsService.create(input)
      }
    )

    registerIpcHandle(ipcMain, "threads:update", async (_event, params: ThreadUpdateParams) => {
      return this.threadsService.update(params)
    })

    registerIpcHandle(
      ipcMain,
      "threads:setPinned",
      async (_event, params: { pinned: boolean; threadId: string }) => {
        return this.threadsService.setPinned(params.threadId, params.pinned)
      }
    )

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
      "threads:agentThreadData",
      async (_event, threadId: string): Promise<AgentThreadDataSnapshot> => {
        const persistedThreadData = await this.threadsService.getPersistedAgentThreadData(threadId)
        return (
          this.agentThreadRunner.readThreadDataOverlay(threadId, persistedThreadData) ??
          persistedThreadData
        )
      }
    )
  }
}
