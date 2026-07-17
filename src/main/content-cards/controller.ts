import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import { z } from "zod/v4"
import {
  assistantContentProjectionChangedEventSchema,
  assistantContentProjectionInspectionListSchema,
  assistantContentPartsResultSchema,
  type AssistantContentProjectionChangedEvent
} from "@shared/assistant-content-part"
import type { DiagnosticEventRef, DiagnosticGraphSink } from "../diagnostics/schema"
import { registerValidatedIpcHandle } from "../ipc/handle"
import { JingleIpcError } from "../ipc/error"
import { assistantContentProjectionEvents } from "./events"
import { ContentCardsService } from "./service"

const getAssistantPartsArgumentsSchema = z.tuple([
  z.object({ messageId: z.string().min(1), threadId: z.string().min(1) })
])
const inspectAssistantPartsArgumentsSchema = z.tuple([
  z
    .object({
      messageIds: z.array(z.string().min(1)).max(100),
      threadId: z.string().min(1)
    })
    .strict()
])

const NOOP_EVENT_REF: DiagnosticEventRef = {
  eventId: "diag:noop:0",
  sequence: 0,
  sessionId: "noop"
}

const NOOP_DIAGNOSTICS: DiagnosticGraphSink = {
  capture: () => NOOP_EVENT_REF
}

export class ContentCardsController {
  constructor(
    private readonly service: ContentCardsService,
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
      "contentCards:getAssistantParts",
      getAssistantPartsArgumentsSchema,
      async (event, input) => {
        this.assertThreadAccess(event, input.threadId)
        return assistantContentPartsResultSchema.parse(await this.service.getAssistantParts(input))
      }
    )
    registerValidatedIpcHandle(
      ipcMain,
      "contentCards:inspectAssistantParts",
      inspectAssistantPartsArgumentsSchema,
      async (event, input) => {
        this.assertThreadAccess(event, input.threadId)
        return assistantContentProjectionInspectionListSchema.parse(
          await this.service.inspectAssistantParts(input)
        )
      }
    )

    assistantContentProjectionEvents.onChanged((event) => {
      this.publishChanged(event)
    })
  }

  private publishChanged(rawEvent: AssistantContentProjectionChangedEvent): void {
    const event = assistantContentProjectionChangedEventSchema.parse(rawEvent)
    for (const window of this.listWindows()) {
      if (window.isDestroyed()) continue
      const sender = window.webContents
      if (sender.isDestroyed()) continue
      const isLauncher = this.senderIdentity.isLauncher(sender)
      const durableThreadId = this.senderIdentity.getDurableThreadId(sender)
      if (
        !(
          (isLauncher && durableThreadId === null) ||
          (!isLauncher && durableThreadId === event.threadId)
        )
      ) {
        continue
      }
      try {
        sender.send("contentCards:changed", event)
      } catch (error) {
        this.diagnostics.capture({
          component: "assistant-content-projection",
          dimensionEntries: [
            { key: "webContentsId", value: sender.id },
            { key: "windowId", value: window.id }
          ],
          eventCode: "assistant_content_projection.change_delivery_failed",
          evidence: [{ kind: "error", value: error }],
          level: "warn",
          operation: "deliver-projection-change",
          recoverable: true,
          refs: [
            { id: event.threadId, kind: "thread" },
            { id: event.messageId, kind: "message" }
          ],
          stateImpact: "content_cards_stale_notification_missed",
          summary: "Assistant content projection change delivery failed"
        })
      }
    }
  }

  private assertThreadAccess(event: IpcMainInvokeEvent, threadId: string): void {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new JingleIpcError({
        code: "PERMISSION_DENIED",
        message: "Content cards require a main frame."
      })
    }
    const isLauncher = this.senderIdentity.isLauncher(event.sender)
    const durableThreadId = this.senderIdentity.getDurableThreadId(event.sender)
    if ((isLauncher && durableThreadId === null) || (!isLauncher && durableThreadId === threadId))
      return
    throw new JingleIpcError({
      code: "PERMISSION_DENIED",
      message: "The window cannot access this thread's content cards."
    })
  }
}
