import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import { z } from "zod/v4"
import type { AgentThreadDataSnapshot, CreateThreadInput, ThreadUpdateParams } from "../types"
import type {
  ModelRuntimeSelection,
  ThreadModelRuntimeSelectionChangedEvent
} from "@shared/app-types"
import { JingleIpcError } from "../ipc/error"
import { registerIpcHandle, registerValidatedIpcHandle } from "../ipc/handle"
import {
  parseModelRuntimeSelection,
  parseThreadModelRuntimeSelectionChangedEvent
} from "@shared/model-runtime-selection"
import { AgentThreadDataSnapshotService } from "./agent-thread-data-snapshot-service"
import { ThreadsService } from "./service"

interface ThreadsControllerSenderIdentity {
  getMainThreadId(sender: WebContents): string | null
  isLauncher(sender: WebContents): boolean
}

const setThreadModelArgumentsSchema = z.tuple([
  z
    .object({
      selection: z.custom<ModelRuntimeSelection>(
        (value) => parseModelRuntimeSelection(value) !== null
      ),
      threadId: z.string().min(1)
    })
    .strict()
])

export class ThreadsController {
  constructor(
    private readonly threadsService: ThreadsService,
    private readonly agentThreadDataSnapshotService: AgentThreadDataSnapshotService,
    private readonly senderIdentity: ThreadsControllerSenderIdentity,
    private readonly listWindows: () => BrowserWindow[] = () => BrowserWindow.getAllWindows()
  ) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "threads:list", async () => {
      return this.threadsService.list()
    })

    registerIpcHandle(ipcMain, "threads:listArchived", async () => {
      return this.threadsService.listArchivedView()
    })

    registerIpcHandle(ipcMain, "threads:get", async (_event, threadId: string) => {
      return this.threadsService.get(threadId)
    })

    registerIpcHandle(ipcMain, "threads:create", async (_event, input?: CreateThreadInput) => {
      return this.threadsService.create(input)
    })

    registerIpcHandle(ipcMain, "threads:update", async (_event, params: ThreadUpdateParams) => {
      return this.threadsService.update(params)
    })

    registerValidatedIpcHandle(
      ipcMain,
      "threads:setModel",
      setThreadModelArgumentsSchema,
      async (event, params) => {
        this.assertThreadAccess(event, params.threadId, "threads:setModel")
        return this.threadsService.setModel(params.threadId, params.selection)
      }
    )

    registerIpcHandle(
      ipcMain,
      "threads:setPinned",
      async (_event, params: { pinned: boolean; threadId: string }) => {
        return this.threadsService.setPinned(params.threadId, params.pinned)
      }
    )

    registerIpcHandle(
      ipcMain,
      "threads:setArchived",
      async (_event, params: { archived: boolean; threadId: string }) => {
        return this.threadsService.setArchived(params.threadId, params.archived)
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
        return this.agentThreadDataSnapshotService.readAgentThreadDataSnapshot(threadId)
      }
    )

    this.threadsService.onModelRuntimeSelectionChanged((event) => {
      this.publishModelRuntimeSelectionChanged(event)
    })
  }

  private assertThreadAccess(
    event: IpcMainInvokeEvent,
    threadId: string,
    channel: "threads:setModel"
  ): void {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new JingleIpcError({
        channel,
        code: "PERMISSION_DENIED",
        message: "Thread models can only be changed from a window's main frame."
      })
    }
    const isLauncher = this.senderIdentity.isLauncher(event.sender)
    const mainThreadId = this.senderIdentity.getMainThreadId(event.sender)
    if ((isLauncher && mainThreadId === null) || (!isLauncher && mainThreadId === threadId)) {
      return
    }
    throw new JingleIpcError({
      channel,
      code: "PERMISSION_DENIED",
      message: "Thread models are only available to the Launcher or a window bound to that thread."
    })
  }

  private publishModelRuntimeSelectionChanged(
    rawEvent: ThreadModelRuntimeSelectionChangedEvent
  ): void {
    const event = parseThreadModelRuntimeSelectionChangedEvent(rawEvent)
    if (!event) {
      console.warn("[Threads] Refused to publish an invalid model runtime selection event.")
      return
    }

    for (const window of this.listWindows()) {
      if (window.isDestroyed()) {
        continue
      }
      const sender = window.webContents
      if (sender.isDestroyed()) {
        continue
      }
      const isLauncher = this.senderIdentity.isLauncher(sender)
      const mainThreadId = this.senderIdentity.getMainThreadId(sender)
      if (
        !((isLauncher && mainThreadId === null) || (!isLauncher && mainThreadId === event.threadId))
      ) {
        continue
      }

      try {
        sender.send("threads:modelRuntimeSelectionChanged", event)
      } catch (error) {
        console.warn("[Threads] Failed to deliver a model runtime selection event.", {
          error,
          revision: event.revision,
          threadId: event.threadId,
          webContentsId: sender.id
        })
      }
    }
  }
}
