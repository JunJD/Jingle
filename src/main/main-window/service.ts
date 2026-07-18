import type { BrowserWindow, WebContents } from "electron"
import type { OpenPrimaryMainWindowParams } from "@shared/durable-window"
import type { MainWindowSessionRepairResult, MainWindowSessionState } from "../preferences"
import {
  summarizeDurableWindowRestoreRepairs,
  type DurableWindowRestoreGate,
  type DurableWindowRestorePolicy,
  type DurableWindowRestoreRepairDiagnostic
} from "../durable-window/restore-policy"

export interface PrimaryMainWindowRuntime {
  createMainWindow: (threadId: string | null) => BrowserWindow
  getSessionState: () => MainWindowSessionState
  onWindowClosed: () => void
  onWindowOpened: () => void
  recordRestoreFailure: (error: unknown) => void
  recordRestoreRepair: (details: DurableWindowRestoreRepairDiagnostic) => void
  repairSessionThreadBinding: (staleThreadId: string) => MainWindowSessionRepairResult
  setSessionState: (state: MainWindowSessionState) => MainWindowSessionState
  setWindowThread: (window: BrowserWindow, threadId: string) => void
}

export class PrimaryMainWindowService {
  private currentThreadId: string | null = null
  private pendingRestore: object | null = null
  private window: BrowserWindow | null = null

  constructor(
    private readonly runtime: PrimaryMainWindowRuntime,
    private readonly restorePolicy: DurableWindowRestorePolicy,
    private readonly restoreGate: DurableWindowRestoreGate
  ) {}

  open(params: OpenPrimaryMainWindowParams = {}): void {
    if (this.restoreGate.isApplicationQuitting()) return
    if (params.threadId) {
      this.pendingRestore = null
      this.openResolved(params.threadId, true)
      return
    }
    if (this.window && !this.window.isDestroyed()) {
      this.focusWindow(this.window)
      return
    }

    const threadId = this.runtime.getSessionState().lastActiveThreadId
    if (threadId === null) {
      this.openResolved(null, false)
      return
    }
    if (this.pendingRestore) return

    const restore = {}
    this.pendingRestore = restore
    void this.restorePersistedBinding(restore, threadId).catch((error) => {
      if (this.pendingRestore !== restore) return
      this.pendingRestore = null
      if (this.restoreGate.isApplicationQuitting()) return
      this.runtime.recordRestoreFailure(error)
      this.openResolved(null, false)
    })
  }

  private openResolved(threadId: string | null, persistRequestedThread: boolean): void {
    if (this.restoreGate.isApplicationQuitting()) return
    if (!this.window || this.window.isDestroyed()) {
      this.window = this.runtime.createMainWindow(threadId)
      this.currentThreadId = threadId
      this.runtime.onWindowOpened()
      if (persistRequestedThread && threadId) {
        this.runtime.setSessionState({ version: 1, lastActiveThreadId: threadId })
      }
      this.window.once("closed", () => {
        this.window = null
        this.currentThreadId = null
        this.runtime.onWindowClosed()
      })
      return
    }
    if (threadId) this.bindThread(this.window, threadId)
    this.focusWindow(this.window)
  }

  bindSenderThread(sender: WebContents, threadId: string): void {
    if (!this.window || this.window.webContents !== sender) {
      throw new Error("Main window thread binding requires the registered Main window.")
    }
    this.bindThread(this.window, threadId, false)
  }

  isSender(sender: WebContents): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.webContents === sender)
  }

  private focusWindow(window: BrowserWindow): void {
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    window.focus()
  }

  private async restorePersistedBinding(restore: object, threadId: string): Promise<void> {
    const resolution = await this.restorePolicy.resolve(threadId)
    if (this.pendingRestore !== restore) return
    if (this.restoreGate.isApplicationQuitting()) {
      this.pendingRestore = null
      return
    }

    if (resolution.action === "restore") {
      this.openResolved(resolution.threadId, false)
      if (this.pendingRestore === restore) this.pendingRestore = null
      return
    }

    const repair = this.runtime.repairSessionThreadBinding(threadId)
    if (!repair.repaired || repair.state.lastActiveThreadId !== null) {
      if (this.pendingRestore === restore) this.pendingRestore = null
      return
    }
    this.runtime.recordRestoreRepair(
      summarizeDurableWindowRestoreRepairs("main", [
        {
          reason: resolution.reason,
          threadId: resolution.threadId,
          windowId: "primary-main"
        }
      ])
    )
    this.openResolved(null, false)
    if (this.pendingRestore === restore) this.pendingRestore = null
  }

  private bindThread(window: BrowserWindow, threadId: string, notify = true): void {
    if (this.currentThreadId === threadId) return
    this.runtime.setWindowThread(window, threadId)
    this.currentThreadId = threadId
    this.runtime.setSessionState({ version: 1, lastActiveThreadId: threadId })
    if (notify && !window.webContents.isDestroyed()) {
      window.webContents.send("durable-window:threadChanged", { threadId })
    }
  }
}
