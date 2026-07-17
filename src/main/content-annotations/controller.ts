import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import { z } from "zod/v4"
import {
  contentAnnotationChangedEventSchema,
  contentAnnotationListSchema,
  contentAnnotationSchema,
  createContentAnnotationInputSchema,
  deleteContentAnnotationInputSchema,
  updateContentAnnotationInputSchema,
  type ContentAnnotationChangedEvent
} from "@shared/content-annotation"
import type { DiagnosticEventRef, DiagnosticGraphSink } from "../diagnostics/schema"
import { registerValidatedIpcHandle } from "../ipc/handle"
import { JingleIpcError } from "../ipc/error"
import { ContentAnnotationsService } from "./service"

const listArgumentsSchema = z.tuple([z.object({ threadId: z.string().min(1) })])
const createArgumentsSchema = z.tuple([createContentAnnotationInputSchema])
const updateArgumentsSchema = z.tuple([updateContentAnnotationInputSchema])
const deleteArgumentsSchema = z.tuple([deleteContentAnnotationInputSchema])

const NOOP_EVENT_REF: DiagnosticEventRef = {
  eventId: "diag:noop:0",
  sequence: 0,
  sessionId: "noop"
}

const NOOP_DIAGNOSTICS: DiagnosticGraphSink = {
  capture: () => NOOP_EVENT_REF
}

export class ContentAnnotationsController {
  constructor(
    private readonly service: ContentAnnotationsService,
    private readonly senderIdentity: {
      getDurableThreadId(sender: WebContents): string | null
      isLauncher(sender: WebContents): boolean
    },
    private readonly listWindows: () => BrowserWindow[] = () => BrowserWindow.getAllWindows(),
    private readonly diagnostics: DiagnosticGraphSink = NOOP_DIAGNOSTICS
  ) {}

  register(ipcMain: IpcMain): void {
    registerValidatedIpcHandle(
      ipcMain,
      "contentAnnotations:list",
      listArgumentsSchema,
      async (event, input) => {
        this.assertThreadAccess(event, input.threadId)
        return contentAnnotationListSchema.parse(await this.service.list(input.threadId))
      }
    )
    registerValidatedIpcHandle(
      ipcMain,
      "contentAnnotations:create",
      createArgumentsSchema,
      async (event, input) => {
        this.assertThreadAccess(event, input.selection.card.threadId)
        return contentAnnotationSchema.parse(await this.service.create(input))
      }
    )
    registerValidatedIpcHandle(
      ipcMain,
      "contentAnnotations:update",
      updateArgumentsSchema,
      async (event, input) => {
        const current = await this.service.get(input.id)
        this.assertThreadAccess(event, current.threadId)
        return contentAnnotationSchema.parse(await this.service.update(input))
      }
    )
    registerValidatedIpcHandle(
      ipcMain,
      "contentAnnotations:delete",
      deleteArgumentsSchema,
      async (event, input) => {
        const current = await this.service.get(input.id)
        this.assertThreadAccess(event, current.threadId)
        return contentAnnotationSchema.parse(await this.service.delete(input))
      }
    )

    this.service.onChanged((annotation) => {
      this.publishChanged({ annotation })
    })
  }

  private publishChanged(rawEvent: ContentAnnotationChangedEvent): void {
    const event = contentAnnotationChangedEventSchema.parse(rawEvent)
    for (const window of this.listWindows()) {
      if (window.isDestroyed()) continue
      const sender = window.webContents
      if (sender.isDestroyed()) continue
      const isLauncher = this.senderIdentity.isLauncher(sender)
      const durableThreadId = this.senderIdentity.getDurableThreadId(sender)
      if (
        !(
          (isLauncher && durableThreadId === null) ||
          (!isLauncher && durableThreadId === event.annotation.threadId)
        )
      ) {
        continue
      }
      try {
        sender.send("contentAnnotations:changed", event)
      } catch (error) {
        this.diagnostics.capture({
          component: "content-annotations",
          dimensionEntries: [
            { key: "webContentsId", value: sender.id },
            { key: "windowId", value: window.id }
          ],
          eventCode: "content_annotation.change_delivery_failed",
          evidence: [{ kind: "error", value: error }],
          level: "warn",
          operation: "deliver-change",
          recoverable: true,
          refs: [
            { id: event.annotation.threadId, kind: "thread" },
            { id: event.annotation.id, kind: "content-annotation" }
          ],
          stateImpact: "annotation_saved_notification_missed",
          summary: "Content annotation change delivery failed"
        })
      }
    }
  }

  private assertThreadAccess(event: IpcMainInvokeEvent, threadId: string): void {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new JingleIpcError({
        code: "PERMISSION_DENIED",
        message: "Annotations require a main frame."
      })
    }
    const isLauncher = this.senderIdentity.isLauncher(event.sender)
    const durableThreadId = this.senderIdentity.getDurableThreadId(event.sender)
    if ((isLauncher && durableThreadId === null) || (!isLauncher && durableThreadId === threadId))
      return
    throw new JingleIpcError({
      code: "PERMISSION_DENIED",
      message: "The window cannot access this thread's annotations."
    })
  }
}
