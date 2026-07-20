import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent, type WebContents } from "electron"
import type { ArtifactActionId, ArtifactChangedEvent } from "@shared/artifacts"
import { registerIpcHandle } from "../ipc/handle"
import { JingleIpcError } from "../ipc/error"
import type { DurableWindowCallerLease } from "../windows/window-identity"
import { ArtifactsService } from "./service"

type ArtifactCallerAccess =
  | { readonly surface: "launcher" }
  | { readonly lease: DurableWindowCallerLease; readonly surface: "durable" }

export class ArtifactsController {
  constructor(
    private readonly artifactsService: ArtifactsService,
    private readonly senderIdentity: {
      getDurableCallerLease(sender: WebContents): DurableWindowCallerLease | null
      isLauncher(sender: WebContents): boolean
    },
    private readonly listWindows: () => BrowserWindow[] = () => BrowserWindow.getAllWindows()
  ) {}

  register(ipcMain: IpcMain): void {
    registerIpcHandle(ipcMain, "artifacts:list", async (event, threadId: string) => {
      const access = this.authorizeThreadAccess(event, threadId, "artifacts:list")
      const artifacts = await this.artifactsService.list(threadId)
      this.assertAccessCurrent(event.sender, access, threadId, "artifacts:list")
      return artifacts
    })

    registerIpcHandle(
      ipcMain,
      "artifacts:open",
      async (event, payload: { action?: ArtifactActionId; artifactId: string }) => {
        const access = await this.authorizeArtifactAccess(
          event,
          payload.artifactId,
          "artifacts:open"
        )
        const assertAccess = (threadId: string): void => {
          if (threadId !== access.threadId) this.throwThreadAccessDenied("artifacts:open")
          this.assertAccessCurrent(event.sender, access.caller, access.threadId, "artifacts:open")
        }
        const resolution = await this.artifactsService.open(
          payload.artifactId,
          payload.action,
          assertAccess
        )
        assertAccess(access.threadId)
        return resolution
      }
    )

    registerIpcHandle(ipcMain, "artifacts:readFile", async (event, artifactId: string) => {
      const access = await this.authorizeArtifactAccess(event, artifactId, "artifacts:readFile")
      const assertAccess = (threadId: string): void => {
        if (threadId !== access.threadId) this.throwThreadAccessDenied("artifacts:readFile")
        this.assertAccessCurrent(event.sender, access.caller, access.threadId, "artifacts:readFile")
      }
      const result = await this.artifactsService.readFile(artifactId, assertAccess)
      assertAccess(access.threadId)
      return result
    })

    registerIpcHandle(ipcMain, "artifacts:readBinaryFile", async (event, artifactId: string) => {
      const access = await this.authorizeArtifactAccess(
        event,
        artifactId,
        "artifacts:readBinaryFile"
      )
      const assertAccess = (threadId: string): void => {
        if (threadId !== access.threadId) {
          this.throwThreadAccessDenied("artifacts:readBinaryFile")
        }
        this.assertAccessCurrent(
          event.sender,
          access.caller,
          access.threadId,
          "artifacts:readBinaryFile"
        )
      }
      const result = await this.artifactsService.readBinaryFile(artifactId, assertAccess)
      assertAccess(access.threadId)
      return result
    })

    this.artifactsService.onChanged((payload: ArtifactChangedEvent) => {
      for (const window of this.listWindows()) {
        if (window.isDestroyed()) continue
        const sender = window.webContents
        if (sender.isDestroyed() || !this.canAccessThread(sender, payload.threadId)) continue
        sender.send("artifacts:changed", payload)
      }
    })
  }

  private async authorizeArtifactAccess(
    event: IpcMainInvokeEvent,
    artifactId: string,
    channel: string
  ): Promise<{ caller: ArtifactCallerAccess; threadId: string }> {
    this.assertMainFrame(event, channel)
    const caller = this.resolveCallerAccess(event.sender, channel)
    const artifact = await this.artifactsService.get(artifactId)
    if (!artifact) {
      throw new JingleIpcError({
        channel,
        code: "NOT_FOUND",
        message: "Artifact not found."
      })
    }
    this.assertAccessCurrent(event.sender, caller, artifact.threadId, channel)
    return { caller, threadId: artifact.threadId }
  }

  private authorizeThreadAccess(
    event: IpcMainInvokeEvent,
    threadId: string,
    channel: string
  ): ArtifactCallerAccess {
    this.assertMainFrame(event, channel)
    const caller = this.resolveCallerAccess(event.sender, channel)
    this.assertAccessCurrent(event.sender, caller, threadId, channel)
    return caller
  }

  private assertMainFrame(event: IpcMainInvokeEvent, channel: string): void {
    if (event.senderFrame === event.sender.mainFrame) return
    throw new JingleIpcError({
      channel,
      code: "PERMISSION_DENIED",
      message: "Artifacts can only be accessed from a window's main frame."
    })
  }

  private resolveCallerAccess(sender: WebContents, channel: string): ArtifactCallerAccess {
    if (this.senderIdentity.isLauncher(sender)) {
      return { surface: "launcher" }
    }
    const lease = this.senderIdentity.getDurableCallerLease(sender)
    if (lease && !lease.signal.aborted && lease.threadId !== null) {
      return { lease, surface: "durable" }
    }
    throw new JingleIpcError({
      channel,
      code: "PERMISSION_DENIED",
      message: "The window cannot access artifacts."
    })
  }

  private assertAccessCurrent(
    sender: WebContents,
    caller: ArtifactCallerAccess,
    threadId: string,
    channel: string
  ): void {
    const current =
      caller.surface === "launcher"
        ? this.senderIdentity.isLauncher(sender)
        : !caller.lease.signal.aborted &&
          caller.lease.threadId === threadId &&
          this.senderIdentity.getDurableCallerLease(sender) === caller.lease
    if (current) return
    this.throwThreadAccessDenied(channel)
  }

  private canAccessThread(sender: WebContents, threadId: string): boolean {
    if (this.senderIdentity.isLauncher(sender)) return true
    const lease = this.senderIdentity.getDurableCallerLease(sender)
    return lease !== null && !lease.signal.aborted && lease.threadId === threadId
  }

  private throwThreadAccessDenied(channel: string): never {
    throw new JingleIpcError({
      channel,
      code: "PERMISSION_DENIED",
      message: "The window cannot access this thread's artifacts."
    })
  }
}
