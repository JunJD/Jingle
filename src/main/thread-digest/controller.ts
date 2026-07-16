import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import { z } from "zod/v4"
import type { DiagnosticEventRef, DiagnosticGraphSink } from "../diagnostics/schema"
import { JingleIpcError } from "../ipc/error"
import { registerValidatedIpcHandle } from "../ipc/handle"
import { ThreadDigestService } from "./service"
import {
  threadDigestRequestSchema,
  type ThreadDigestChangedEvent,
  type ThreadDigestRecord
} from "@shared/thread-digest"

const threadDigestRequestArgumentsSchema = z.tuple([threadDigestRequestSchema])

interface ThreadDigestSenderIdentity {
  getPinnedThreadId(sender: WebContents): string | null
  isLauncher(sender: WebContents): boolean
}

const NOOP_EVENT_REF: DiagnosticEventRef = {
  eventId: "diag:noop:0",
  sequence: 0,
  sessionId: "noop"
}

const NOOP_DIAGNOSTICS: DiagnosticGraphSink = {
  capture: () => NOOP_EVENT_REF
}

export class ThreadDigestController {
  constructor(
    private readonly service: ThreadDigestService,
    private readonly senderIdentity: ThreadDigestSenderIdentity,
    private readonly listWindows: () => BrowserWindow[] = () => BrowserWindow.getAllWindows(),
    private readonly diagnostics: DiagnosticGraphSink = NOOP_DIAGNOSTICS
  ) {}

  register(ipcMain: IpcMain): void {
    registerValidatedIpcHandle(
      ipcMain,
      "threadDigest:get",
      threadDigestRequestArgumentsSchema,
      async (event, input) => {
        this.assertThreadAccess(event, input.threadId, "threadDigest:get")
        return this.service.get(input.threadId)
      }
    )
    registerValidatedIpcHandle(
      ipcMain,
      "threadDigest:generate",
      threadDigestRequestArgumentsSchema,
      async (event, input) => {
        this.assertThreadAccess(event, input.threadId, "threadDigest:generate")
        return this.service.generate(input.threadId)
      }
    )

    this.service.onChanged((digest, cause) => {
      this.publishChanged(digest, cause)
    })
  }

  private assertThreadAccess(
    event: IpcMainInvokeEvent,
    threadId: string,
    channel: "threadDigest:generate" | "threadDigest:get"
  ): void {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new JingleIpcError({
        channel,
        code: "PERMISSION_DENIED",
        message: "Thread digests can only be accessed from a window's main frame."
      })
    }

    const isLauncher = this.senderIdentity.isLauncher(event.sender)
    const pinnedThreadId = this.senderIdentity.getPinnedThreadId(event.sender)
    if (isLauncher && pinnedThreadId === null) {
      return
    }
    if (pinnedThreadId === threadId && !isLauncher) {
      return
    }

    throw new JingleIpcError({
      channel,
      code: "PERMISSION_DENIED",
      message: "Thread digests are only available to the Launcher or the bound Pinned AI session."
    })
  }

  private publishChanged(digest: ThreadDigestRecord, cause?: DiagnosticEventRef): void {
    const payload = { digest } satisfies ThreadDigestChangedEvent
    for (const window of this.listWindows()) {
      if (window.isDestroyed()) {
        continue
      }

      const sender = window.webContents
      if (sender.isDestroyed()) {
        continue
      }
      const isLauncher = this.senderIdentity.isLauncher(sender)
      const pinnedThreadId = this.senderIdentity.getPinnedThreadId(sender)
      if (
        (isLauncher && pinnedThreadId === null) ||
        (!isLauncher && pinnedThreadId === digest.threadId)
      ) {
        try {
          sender.send("threadDigest:changed", payload)
        } catch (error) {
          this.diagnostics.capture({
            component: "thread-digest",
            dimensionEntries: [
              { key: "digestUpdatedAt", value: digest.updatedAt },
              { key: "projectedThroughSeq", value: digest.projectedThroughSeq },
              { key: "surface", value: isLauncher ? "launcher" : "pinned-ai-session" },
              { key: "webContentsId", value: sender.id },
              { key: "windowId", value: window.id }
            ],
            eventCode: "thread_digest.change_delivery_failed",
            evidence: [{ kind: "error", value: error }],
            level: "warn",
            operation: "publish-change",
            parentEvents: cause ? [cause] : [],
            recoverable: true,
            refs: [
              { id: digest.threadId, kind: "thread" },
              { id: `${digest.threadId}:${digest.updatedAt}`, kind: "thread-digest" },
              { id: String(window.id), kind: "window" },
              { id: String(sender.id), kind: "web-contents" }
            ],
            stateImpact: "digest_saved_notification_missed",
            summary: "Thread digest change delivery failed"
          })
        }
      }
    }
  }
}
