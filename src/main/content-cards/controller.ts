import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { z } from "zod/v4"
import { assistantContentPartsResultSchema } from "@shared/assistant-content-part"
import { registerValidatedIpcHandle } from "../ipc/handle"
import { JingleIpcError } from "../ipc/error"
import { ContentCardsService } from "./service"

const getAssistantPartsArgumentsSchema = z.tuple([
  z.object({ messageId: z.string().min(1), threadId: z.string().min(1) })
])

export class ContentCardsController {
  constructor(
    private readonly service: ContentCardsService,
    private readonly senderIdentity: {
      getDurableThreadId(sender: WebContents): string | null
      isLauncher(sender: WebContents): boolean
    }
  ) {}

  register(ipcMain: IpcMain): void {
    registerValidatedIpcHandle(
      ipcMain,
      "contentCards:getAssistantParts",
      getAssistantPartsArgumentsSchema,
      async (event, input) => {
        this.assertThreadAccess(event, input.threadId)
        return assistantContentPartsResultSchema.parse(
          await this.service.getAssistantParts(input)
        )
      }
    )
  }

  private assertThreadAccess(event: IpcMainInvokeEvent, threadId: string): void {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new JingleIpcError({ code: "PERMISSION_DENIED", message: "Content cards require a main frame." })
    }
    const isLauncher = this.senderIdentity.isLauncher(event.sender)
    const durableThreadId = this.senderIdentity.getDurableThreadId(event.sender)
    if ((isLauncher && durableThreadId === null) || (!isLauncher && durableThreadId === threadId)) return
    throw new JingleIpcError({
      code: "PERMISSION_DENIED",
      message: "The window cannot access this thread's content cards."
    })
  }
}
