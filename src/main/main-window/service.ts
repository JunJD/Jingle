import type { BrowserWindow, WebContents } from "electron"
import type { OpenPrimaryMainWindowParams } from "@shared/durable-window"
import type { MainWindowSessionState } from "../preferences"

export interface PrimaryMainWindowRuntime {
  createMainWindow: (threadId: string | null) => BrowserWindow
  getSessionState: () => MainWindowSessionState
  onWindowClosed: () => void
  onWindowOpened: () => void
  setSessionState: (state: MainWindowSessionState) => MainWindowSessionState
  setWindowThread: (window: BrowserWindow, threadId: string) => void
}

export class PrimaryMainWindowService {
  private currentThreadId: string | null = null
  private window: BrowserWindow | null = null

  constructor(private readonly runtime: PrimaryMainWindowRuntime) {}

  open(params: OpenPrimaryMainWindowParams = {}): void {
    const threadId = params.threadId ?? this.runtime.getSessionState().lastActiveThreadId
    if (!this.window || this.window.isDestroyed()) {
      this.window = this.runtime.createMainWindow(threadId)
      this.currentThreadId = threadId
      this.runtime.onWindowOpened()
      if (params.threadId)
        this.runtime.setSessionState({ version: 1, lastActiveThreadId: params.threadId })
      this.window.once("closed", () => {
        this.window = null
        this.currentThreadId = null
        this.runtime.onWindowClosed()
      })
      return
    }
    if (params.threadId) this.bindThread(this.window, params.threadId)
    if (this.window.isMinimized()) this.window.restore()
    if (!this.window.isVisible()) this.window.show()
    this.window.focus()
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
