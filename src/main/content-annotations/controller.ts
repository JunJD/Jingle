import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { z } from "zod/v4"
import {
  contentAnnotationListSchema,
  contentAnnotationSchema,
  createContentAnnotationInputSchema,
  deleteContentAnnotationInputSchema,
  updateContentAnnotationInputSchema
} from "@shared/content-annotation"
import { registerValidatedIpcHandle } from "../ipc/handle"
import { JingleIpcError } from "../ipc/error"
import { ContentAnnotationsService } from "./service"

const listArgumentsSchema = z.tuple([z.object({ threadId: z.string().min(1) })])
const createArgumentsSchema = z.tuple([createContentAnnotationInputSchema])
const updateArgumentsSchema = z.tuple([updateContentAnnotationInputSchema])
const deleteArgumentsSchema = z.tuple([deleteContentAnnotationInputSchema])

export class ContentAnnotationsController {
  constructor(
    private readonly service: ContentAnnotationsService,
    private readonly senderIdentity: {
      getDurableThreadId(sender: WebContents): string | null
      isLauncher(sender: WebContents): boolean
    }
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
