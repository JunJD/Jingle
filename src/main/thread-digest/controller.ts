import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import { z } from "zod/v4"
import type { DiagnosticsLogger } from "../diagnostics/logger"
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

type ThreadDigestDiagnostics = Pick<DiagnosticsLogger, "warn">

const NOOP_DIAGNOSTICS: ThreadDigestDiagnostics = {
  warn: () => {}
}

export class ThreadDigestController {
  constructor(
    private readonly service: ThreadDigestService,
    private readonly senderIdentity: ThreadDigestSenderIdentity,
    private readonly listWindows: () => BrowserWindow[] = () => BrowserWindow.getAllWindows(),
    private readonly diagnostics: ThreadDigestDiagnostics = NOOP_DIAGNOSTICS
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

    this.service.onChanged((digest) => {
      this.publishChanged(digest)
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

  private publishChanged(digest: ThreadDigestRecord): void {
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
          this.diagnostics.warn("Thread digest change delivery failed", {
            digestUpdatedAt: digest.updatedAt,
            error: error instanceof Error ? error.message : String(error),
            projectedThroughSeq: digest.projectedThroughSeq,
            surface: isLauncher ? "launcher" : "pinned-ai-session",
            threadId: digest.threadId,
            webContentsId: sender.id,
            windowId: window.id
          })
        }
      }
    }
  }
}
