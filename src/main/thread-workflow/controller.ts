import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import { z } from "zod/v4"
import { JingleIpcError } from "../ipc/error"
import { registerValidatedIpcHandle } from "../ipc/handle"
import { ThreadWorkflowService } from "./service"
import {
  addThreadWorkflowLabelInputSchema,
  createProjectWorkflowLabelInputSchema,
  createProjectWorkflowStatusInputSchema,
  getThreadWorkflowRequestSchema,
  listProjectWorkflowsRequestSchema,
  projectWorkflowDefinitionSchema,
  projectWorkflowDefinitionsSchema,
  removeThreadWorkflowLabelInputSchema,
  setProjectDefaultWorkflowStatusInputSchema,
  setThreadWorkflowStatusInputSchema,
  threadWorkflowChangedEventSchema,
  threadWorkflowViewSchema,
  type ThreadWorkflowChangedEvent
} from "@shared/thread-workflow"

const getThreadWorkflowArgumentsSchema = z.tuple([getThreadWorkflowRequestSchema])
const createProjectWorkflowStatusArgumentsSchema = z.tuple([createProjectWorkflowStatusInputSchema])
const setProjectDefaultWorkflowStatusArgumentsSchema = z.tuple([
  setProjectDefaultWorkflowStatusInputSchema
])
const createProjectWorkflowLabelArgumentsSchema = z.tuple([createProjectWorkflowLabelInputSchema])
const setThreadWorkflowStatusArgumentsSchema = z.tuple([setThreadWorkflowStatusInputSchema])
const addThreadWorkflowLabelArgumentsSchema = z.tuple([addThreadWorkflowLabelInputSchema])
const removeThreadWorkflowLabelArgumentsSchema = z.tuple([removeThreadWorkflowLabelInputSchema])

type ThreadWorkflowChannel =
  | "threadWorkflow:addLabel"
  | "threadWorkflow:createLabel"
  | "threadWorkflow:createStatus"
  | "threadWorkflow:get"
  | "threadWorkflow:listProjects"
  | "threadWorkflow:removeLabel"
  | "threadWorkflow:setDefaultStatus"
  | "threadWorkflow:setStatus"

interface ThreadWorkflowSenderIdentity {
  getMainThreadId(sender: WebContents): string | null
  isLauncher(sender: WebContents): boolean
}

export class ThreadWorkflowController {
  constructor(
    private readonly service: ThreadWorkflowService,
    private readonly senderIdentity: ThreadWorkflowSenderIdentity,
    private readonly listWindows: () => BrowserWindow[] = () => BrowserWindow.getAllWindows()
  ) {}

  register(ipcMain: IpcMain): void {
    registerValidatedIpcHandle(
      ipcMain,
      "threadWorkflow:listProjects",
      listProjectWorkflowsRequestSchema,
      async (event) => {
        this.assertLauncher(event, "threadWorkflow:listProjects")
        return projectWorkflowDefinitionsSchema.parse(await this.service.listProjects())
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "threadWorkflow:get",
      getThreadWorkflowArgumentsSchema,
      async (event, input) => {
        this.assertThreadAccess(event, input.threadId, "threadWorkflow:get")
        return threadWorkflowViewSchema.parse(await this.service.getView(input.threadId))
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "threadWorkflow:createStatus",
      createProjectWorkflowStatusArgumentsSchema,
      async (event, input) => {
        this.assertLauncher(event, "threadWorkflow:createStatus")
        return projectWorkflowDefinitionSchema.parse(await this.service.createStatus(input))
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "threadWorkflow:setDefaultStatus",
      setProjectDefaultWorkflowStatusArgumentsSchema,
      async (event, input) => {
        this.assertLauncher(event, "threadWorkflow:setDefaultStatus")
        return projectWorkflowDefinitionSchema.parse(await this.service.setDefaultStatus(input))
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "threadWorkflow:createLabel",
      createProjectWorkflowLabelArgumentsSchema,
      async (event, input) => {
        this.assertLauncher(event, "threadWorkflow:createLabel")
        return projectWorkflowDefinitionSchema.parse(await this.service.createLabel(input))
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "threadWorkflow:setStatus",
      setThreadWorkflowStatusArgumentsSchema,
      async (event, input) => {
        this.assertThreadAccess(event, input.threadId, "threadWorkflow:setStatus")
        return threadWorkflowViewSchema.parse(await this.service.setStatus(input))
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "threadWorkflow:addLabel",
      addThreadWorkflowLabelArgumentsSchema,
      async (event, input) => {
        this.assertThreadAccess(event, input.threadId, "threadWorkflow:addLabel")
        return threadWorkflowViewSchema.parse(await this.service.addLabel(input))
      }
    )

    registerValidatedIpcHandle(
      ipcMain,
      "threadWorkflow:removeLabel",
      removeThreadWorkflowLabelArgumentsSchema,
      async (event, input) => {
        this.assertThreadAccess(event, input.threadId, "threadWorkflow:removeLabel")
        return threadWorkflowViewSchema.parse(await this.service.removeLabel(input))
      }
    )

    this.service.onChanged((event) => {
      void this.publishChanged(event).catch((error: unknown) => {
        console.warn("[ThreadWorkflow] Failed to publish a change event.", {
          error,
          scope: event.scope
        })
      })
    })
  }

  private assertMainFrame(event: IpcMainInvokeEvent, channel: ThreadWorkflowChannel): void {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new JingleIpcError({
        channel,
        code: "PERMISSION_DENIED",
        message: "Thread workflows can only be accessed from a window's main frame."
      })
    }
  }

  private assertLauncher(event: IpcMainInvokeEvent, channel: ThreadWorkflowChannel): void {
    this.assertMainFrame(event, channel)
    if (
      !this.senderIdentity.isLauncher(event.sender) ||
      this.senderIdentity.getMainThreadId(event.sender) !== null
    ) {
      throw new JingleIpcError({
        channel,
        code: "PERMISSION_DENIED",
        message: "Project workflow definitions are only available from the Launcher."
      })
    }
  }

  private assertThreadAccess(
    event: IpcMainInvokeEvent,
    threadId: string,
    channel: ThreadWorkflowChannel
  ): void {
    this.assertMainFrame(event, channel)
    const isLauncher = this.senderIdentity.isLauncher(event.sender)
    const mainThreadId = this.senderIdentity.getMainThreadId(event.sender)
    if ((isLauncher && mainThreadId === null) || (!isLauncher && mainThreadId === threadId)) {
      return
    }

    throw new JingleIpcError({
      channel,
      code: "PERMISSION_DENIED",
      message: "Thread workflows are only available to the Launcher or the bound Main window."
    })
  }

  private async publishChanged(rawEvent: ThreadWorkflowChangedEvent): Promise<void> {
    const event = threadWorkflowChangedEventSchema.parse(rawEvent)
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
      let canReceive =
        event.scope === "thread" &&
        ((isLauncher && mainThreadId === null) || (!isLauncher && mainThreadId === event.threadId))
      if (event.scope === "project") {
        canReceive = isLauncher && mainThreadId === null
        if (!isLauncher && mainThreadId !== null) {
          try {
            const view = await this.service.getView(mainThreadId)
            canReceive = view.project?.projectId === event.projectId
          } catch (error) {
            console.warn("[ThreadWorkflow] Failed to resolve Main window project access.", {
              error,
              webContentsId: sender.id
            })
            continue
          }
        }
      }
      if (!canReceive) {
        continue
      }

      try {
        sender.send("threadWorkflow:changed", event)
      } catch (error) {
        console.warn("[ThreadWorkflow] Failed to deliver a change event.", {
          error,
          scope: event.scope,
          webContentsId: sender.id
        })
      }
    }
  }
}
