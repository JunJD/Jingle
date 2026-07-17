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
  createThreadWindow: (
    input: ThreadWindowRestoreEntry,
    options: { activate: boolean; onRendererFailure: () => void }
  ) => BrowserWindow
  getRestoreState: () => ThreadWindowRestoreState
  onWindowClosed: () => void
  onWindowOpened: () => void
  recordResourceRefusal: (details: { current: number; limit: number }) => void
  recordRestoreFailure: (details: { error: unknown; windowId: string | null }) => void
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
  private readonly deferredRestoreEntries = new Map<string, ThreadWindowRestoreEntry>()
  private readonly threadIds = new Map<string, string | null>()
  private readonly windows = new Map<string, BrowserWindow>()
  private isApplicationQuitting = false
  private persistTimer: NodeJS.Timeout | null = null
  private restoreStarted = false

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

  async restore(): Promise<void> {
    if (this.restoreStarted) return
    this.restoreStarted = true

    let state: ThreadWindowRestoreState
    try {
      state = this.runtime.getRestoreState()
    } catch (error) {
      this.runtime.recordRestoreFailure({ error, windowId: null })
      return
    }

    const seenWindowIds = new Set<string>()
    const restoreEntries = state.windows.map((entry) => {
      if (seenWindowIds.has(entry.windowId)) {
        const replacement = { ...entry, windowId: randomUUID() }
        this.runtime.recordRestoreFailure({
          error: new Error(
            `Replaced duplicate Thread window restore identity ${entry.windowId} with ${replacement.windowId}.`
          ),
          windowId: entry.windowId
        })
        seenWindowIds.add(replacement.windowId)
        return replacement
      }
      seenWindowIds.add(entry.windowId)
      return entry
    })

    for (const entry of restoreEntries) {
      this.deferredRestoreEntries.set(entry.windowId, entry)
    }
    if (restoreEntries.some((entry, index) => entry.windowId !== state.windows[index]?.windowId)) {
      this.persistAll()
    }

    let resourceRefusalRecorded = false
    if (restoreEntries.length > Math.max(0, this.resourceLimit - this.windows.size)) {
      this.runtime.recordResourceRefusal({
        current: state.windows.length,
        limit: this.resourceLimit
      })
      resourceRefusalRecorded = true
    }

    for (const entry of restoreEntries) {
      await new Promise<void>((resolve) => setImmediate(resolve))
      if (this.isApplicationQuitting) break
      if (this.windows.size >= this.resourceLimit) {
        if (!resourceRefusalRecorded) {
          this.runtime.recordResourceRefusal({
            current: this.windows.size + this.deferredRestoreEntries.size,
            limit: this.resourceLimit
          })
        }
        break
      }
      try {
        this.openEntry(entry, true)
        this.deferredRestoreEntries.delete(entry.windowId)
      } catch (error) {
        this.runtime.recordRestoreFailure({ error, windowId: entry.windowId })
      }
    }
    this.persistAll()
  }

  private openEntry(entry: ThreadWindowRestoreEntry, restoring: boolean): void {
    let rendererFailed = false
    const window = this.runtime.createThreadWindow(entry, {
      activate: !restoring,
      onRendererFailure: () => {
        rendererFailed = true
      }
    })
    if (window.isDestroyed())
      throw new Error(`Thread window was destroyed during creation: ${entry.windowId}`)
    this.runtime.onWindowOpened()
    this.windows.set(entry.windowId, window)
    this.threadIds.set(entry.windowId, entry.threadId)
    if (!restoring) this.persistAll()
    const persist = (): void => this.schedulePersist()
    window.on("move", persist)
    window.on("resize", persist)
    window.on("maximize", persist)
    window.on("unmaximize", persist)
    let restoreConfirmed = !restoring
    if (restoring) {
      window.once("ready-to-show", () => {
        restoreConfirmed = true
      })
    }
    window.once("closed", () => {
      this.windows.delete(entry.windowId)
      this.threadIds.delete(entry.windowId)
      if (!restoreConfirmed || rendererFailed) {
        this.deferredRestoreEntries.set(entry.windowId, entry)
      }
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
    const liveWindows = [...this.windows.entries()].flatMap(([windowId, window]) => {
      if (window.isDestroyed()) return []
      return [
        {
          bounds: window.getNormalBounds(),
          isMaximized: window.isMaximized(),
          threadId: this.threadIds.get(windowId) ?? null,
          windowId
        }
      ]
    })
    const liveWindowIds = new Set(liveWindows.map(({ windowId }) => windowId))
    const deferredWindows = [...this.deferredRestoreEntries.values()].filter(
      ({ windowId }) => !liveWindowIds.has(windowId)
    )
    this.persistRestoreEntries([...liveWindows, ...deferredWindows])
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistAll()
    }, PERSIST_DEBOUNCE_MS)
    this.persistTimer.unref()
  }

  private persistRestoreEntries(windows: ThreadWindowRestoreEntry[]): void {
    try {
      this.runtime.setRestoreState({ version: 1, windows })
    } catch (error) {
      this.runtime.recordRestoreFailure({ error, windowId: null })
    }
  }

  private flushPersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.persistAll()
  }
}
