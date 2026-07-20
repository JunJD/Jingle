import type { BrowserWindow, WebContents } from "electron"
import {
  MAIN_WINDOW_THREAD_BINDING_CHANGED_CHANNEL,
  type MainWindowThreadBindingSnapshot,
  type OpenPrimaryMainWindowParams
} from "@shared/durable-window"
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
  getWindowBinding: (
    window: BrowserWindow
  ) => { kind: "main"; threadId: string | null } | { kind: "replaced" }
  onWindowClosed: () => void
  onWindowOpened: () => void
  recordRestoreFailure: (error: unknown) => void
  recordRestoreRepair: (details: DurableWindowRestoreRepairDiagnostic) => void
  repairSessionThreadBinding: (staleThreadId: string) => MainWindowSessionRepairResult
  setSessionState: (state: MainWindowSessionState) => MainWindowSessionState
  setWindowThread: (window: BrowserWindow, threadId: string) => void
}

export class PrimaryMainWindowService {
  private bindingRevision = 0
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
      const nextBindingRevision = this.getNextBindingRevision()
      if (persistRequestedThread && threadId) {
        this.runtime.setSessionState({ version: 1, lastActiveThreadId: threadId })
      }
      const openedWindow = this.runtime.createMainWindow(threadId)
      this.window = openedWindow
      this.currentThreadId = threadId
      this.bindingRevision = nextBindingRevision
      this.runtime.onWindowOpened()
      openedWindow.once("closed", () => {
        if (this.window === openedWindow) {
          this.window = null
          this.currentThreadId = null
        }
        this.runtime.onWindowClosed()
      })
      return
    }
    if (threadId) this.bindThread(this.window, threadId)
    this.focusWindow(this.window)
  }

  bindSenderThread(sender: WebContents, threadId: string): MainWindowThreadBindingSnapshot {
    if (!this.window || this.window.webContents !== sender) {
      throw new Error("Main window thread binding requires the registered Main window.")
    }
    return this.bindThread(this.window, threadId, false)
  }

  getSenderThreadBinding(sender: WebContents): MainWindowThreadBindingSnapshot {
    if (!this.window || this.window.isDestroyed() || this.window.webContents !== sender) {
      throw new Error("Main window thread binding requires the registered Main window.")
    }
    return this.getBindingSnapshot()
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

  private bindThread(
    window: BrowserWindow,
    threadId: string,
    notify = true
  ): MainWindowThreadBindingSnapshot {
    if (this.currentThreadId === threadId) {
      if (this.runtime.getSessionState().lastActiveThreadId !== threadId) {
        this.runtime.setSessionState({ version: 1, lastActiveThreadId: threadId })
      }
      return this.getBindingSnapshot()
    }
    const nextBindingRevision = this.getNextBindingRevision()
    let bindingError: unknown = null
    try {
      this.runtime.setWindowThread(window, threadId)
    } catch (error) {
      bindingError = error
    }

    const authoritativeBinding = this.runtime.getWindowBinding(window)
    if (authoritativeBinding.kind === "replaced") {
      window.destroy()
      throw bindingError ?? new Error("Main window identity was replaced during thread binding.")
    }
    const authoritativeThreadId = authoritativeBinding.threadId
    if (bindingError === null && authoritativeThreadId !== threadId) {
      bindingError = new Error("Main window thread identity did not commit the requested binding.")
    }
    if (bindingError !== null && authoritativeThreadId === this.currentThreadId) {
      throw bindingError
    }

    let persistenceError: unknown = null
    try {
      this.runtime.setSessionState({ version: 1, lastActiveThreadId: authoritativeThreadId })
    } catch (error) {
      persistenceError = error
    }
    const snapshot = this.commitBinding(
      window,
      authoritativeThreadId,
      nextBindingRevision,
      notify || bindingError !== null || persistenceError !== null
    )
    if (bindingError !== null && persistenceError !== null) {
      throw new AggregateError(
        [bindingError, persistenceError],
        "Main window thread identity was superseded and its session persistence also failed."
      )
    }
    if (bindingError !== null) throw bindingError
    if (persistenceError !== null) throw persistenceError
    return snapshot
  }

  private commitBinding(
    window: BrowserWindow,
    threadId: string | null,
    revision: number,
    notify: boolean
  ): MainWindowThreadBindingSnapshot {
    this.currentThreadId = threadId
    this.bindingRevision = revision
    const snapshot = this.getBindingSnapshot()
    if (notify && !window.webContents.isDestroyed()) {
      window.webContents.send(MAIN_WINDOW_THREAD_BINDING_CHANGED_CHANNEL, snapshot)
    }
    return snapshot
  }

  private getNextBindingRevision(): number {
    const nextBindingRevision = this.bindingRevision + 1
    if (!Number.isSafeInteger(nextBindingRevision)) {
      throw new Error("Main window thread binding revision space is exhausted.")
    }
    return nextBindingRevision
  }

  private getBindingSnapshot(): MainWindowThreadBindingSnapshot {
    if (this.bindingRevision < 1) {
      throw new Error("Main window thread binding is unavailable.")
    }
    return Object.freeze({
      revision: this.bindingRevision,
      threadId: this.currentThreadId
    })
  }
}
