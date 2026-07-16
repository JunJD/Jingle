import type { BrowserWindow, WebContents } from "electron"
import { randomUUID } from "node:crypto"
import { totalmem } from "node:os"
import type { PinThreadWindowParams, PinThreadWindowResult } from "@shared/durable-window"
import type { ThreadWindowRestoreEntry, ThreadWindowRestoreState } from "../preferences"

const BYTES_PER_THREAD_WINDOW_BUDGET = 512 * 1024 * 1024
const MIN_THREAD_WINDOW_LIMIT = 8
const MAX_THREAD_WINDOW_LIMIT = 64
const PERSIST_DEBOUNCE_MS = 250

export interface ThreadWindowRuntime {
  createThreadWindow: (input: ThreadWindowRestoreEntry) => BrowserWindow
  getRestoreState: () => ThreadWindowRestoreState
  onWindowClosed: () => void
  onWindowOpened: () => void
  recordResourceRefusal: (details: { current: number; limit: number }) => void
  setRestoreState: (state: ThreadWindowRestoreState) => ThreadWindowRestoreState
  setWindowThread: (window: BrowserWindow, threadId: string) => void
}

export function resolveThreadWindowResourceLimit(memoryBytes = totalmem()): number {
  return Math.max(
    MIN_THREAD_WINDOW_LIMIT,
    Math.min(MAX_THREAD_WINDOW_LIMIT, Math.floor(memoryBytes / BYTES_PER_THREAD_WINDOW_BUDGET))
  )
}

export class ThreadWindowService {
  private readonly threadIds = new Map<string, string | null>()
  private readonly windows = new Map<string, BrowserWindow>()
  private isApplicationQuitting = false
  private persistTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly runtime: ThreadWindowRuntime,
    private readonly resourceLimit = resolveThreadWindowResourceLimit()
  ) {}

  openNew(params: PinThreadWindowParams = {}): PinThreadWindowResult {
    if (this.windows.size >= this.resourceLimit) {
      const refusal = { current: this.windows.size, limit: this.resourceLimit }
      this.runtime.recordResourceRefusal(refusal)
      return { ...refusal, ok: false, reason: "resource_limit" }
    }
    const windowId = randomUUID()
    this.openEntry({ isMaximized: false, threadId: params.threadId ?? null, windowId }, false)
    return { ok: true, windowId }
  }

  bindSenderThread(sender: WebContents, threadId: string): void {
    const entry = [...this.windows.entries()].find(([, window]) => window.webContents === sender)
    if (!entry) throw new Error("Thread window binding requires a registered window sender.")
    this.bindThread(entry[0], entry[1], threadId)
  }

  isSender(sender: WebContents): boolean {
    return [...this.windows.values()].some((window) => window.webContents === sender)
  }

  markApplicationQuitting(): void {
    this.isApplicationQuitting = true
    this.flushPersist()
  }

  restore(): void {
    const state = this.runtime.getRestoreState()
    const retained = state.windows.slice(0, this.resourceLimit)
    if (retained.length < state.windows.length) {
      this.runtime.recordResourceRefusal({ current: state.windows.length, limit: this.resourceLimit })
      this.runtime.setRestoreState({ version: 1, windows: retained })
    }
    for (const entry of retained) {
      this.openEntry(entry, true)
    }
  }

  private openEntry(entry: ThreadWindowRestoreEntry, restoring: boolean): void {
    const window = this.runtime.createThreadWindow(entry)
    this.runtime.onWindowOpened()
    this.windows.set(entry.windowId, window)
    this.threadIds.set(entry.windowId, entry.threadId)
    if (!restoring) this.persistAll()
    const persist = (): void => this.schedulePersist()
    window.on("move", persist)
    window.on("resize", persist)
    window.on("maximize", persist)
    window.on("unmaximize", persist)
    window.once("closed", () => {
      this.windows.delete(entry.windowId)
      this.threadIds.delete(entry.windowId)
      this.runtime.onWindowClosed()
      if (!this.isApplicationQuitting) this.schedulePersist()
    })
  }

  private bindThread(windowId: string, window: BrowserWindow, threadId: string): void {
    if (this.threadIds.get(windowId) === threadId) return
    this.runtime.setWindowThread(window, threadId)
    this.threadIds.set(windowId, threadId)
    this.persistAll()
    if (!window.webContents.isDestroyed()) {
      window.webContents.send("durable-window:threadChanged", { threadId })
    }
  }

  private persistAll(): void {
    const windows = [...this.windows.entries()].flatMap(([windowId, window]) => {
      if (window.isDestroyed()) return []
      return [{
        bounds: window.getNormalBounds(),
        isMaximized: window.isMaximized(),
        threadId: this.threadIds.get(windowId) ?? null,
        windowId
      }]
    })
    this.runtime.setRestoreState({ version: 1, windows })
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistAll()
    }, PERSIST_DEBOUNCE_MS)
    this.persistTimer.unref()
  }

  private flushPersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.persistAll()
  }
}
