import type { BrowserWindow, WebContents } from "electron"
import { randomUUID } from "node:crypto"
import { totalmem } from "node:os"
import type { PinThreadWindowParams, PinThreadWindowResult } from "@shared/durable-window"
import type { ThreadWindowRestoreEntry, ThreadWindowRestoreState } from "../preferences"
import {
  DurableWindowRestoreGate,
  summarizeDurableWindowRestoreRepairs,
  type DurableWindowRestorePolicy,
  type DurableWindowRestoreRepairDiagnostic,
  type DiscardedPersistedThreadBinding,
  type PersistedThreadBindingResolution
} from "../durable-window/restore-policy"

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
  getWindowBinding: (
    window: BrowserWindow
  ) => { kind: "thread-window"; threadId: string | null; windowId: string } | { kind: "replaced" }
  onWindowClosed: () => void
  onWindowOpened: () => void
  recordResourceRefusal: (details: { current: number; limit: number }) => void
  recordRestoreFailure: (details: { error: unknown; windowId: string | null }) => void
  recordRestoreRepair: (details: DurableWindowRestoreRepairDiagnostic) => void
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
  private readonly persistedEntries = new Map<string, ThreadWindowRestoreEntry>()
  private readonly threadIds = new Map<string, string | null>()
  private readonly windows = new Map<string, BrowserWindow>()
  private persistTimer: NodeJS.Timeout | null = null
  private restoreStarted = false

  constructor(
    private readonly runtime: ThreadWindowRuntime,
    private readonly restorePolicy: DurableWindowRestorePolicy,
    private readonly resourceLimit = resolveThreadWindowResourceLimit(),
    private readonly restoreGate = new DurableWindowRestoreGate()
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
    this.restoreGate.markApplicationQuitting()
    this.flushPersist()
  }

  async restore(): Promise<void> {
    if (this.restoreStarted) return
    this.restoreStarted = true

    let state: ThreadWindowRestoreState
    try {
      state = this.runtime.getRestoreState()
      this.replacePersistedEntries(state.windows)
    } catch (error) {
      this.runtime.recordRestoreFailure({ error, windowId: null })
      return
    }

    const seenWindowIds = new Set<string>()
    const normalizedEntries = state.windows.map((entry) => {
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

    for (const entry of normalizedEntries) {
      this.deferredRestoreEntries.set(entry.windowId, entry)
    }
    if (
      normalizedEntries.some((entry, index) => entry.windowId !== state.windows[index]?.windowId) &&
      !this.persistAll()
    ) {
      return
    }

    const restoreEntries: ThreadWindowRestoreEntry[] = []
    const discardedBindings: DiscardedPersistedThreadBinding[] = []
    const resolutions = new Map<
      string,
      { error: unknown } | { resolution: PersistedThreadBindingResolution }
    >()
    for (const entry of normalizedEntries) {
      if (entry.threadId === null || resolutions.has(entry.threadId)) continue
      try {
        resolutions.set(entry.threadId, {
          resolution: await this.restorePolicy.resolve(entry.threadId)
        })
      } catch (error) {
        resolutions.set(entry.threadId, { error })
        this.runtime.recordRestoreFailure({ error, windowId: entry.windowId })
      }
    }

    for (const entry of normalizedEntries) {
      if (entry.threadId === null) {
        restoreEntries.push(entry)
        continue
      }
      const result = resolutions.get(entry.threadId)
      if (!result || "error" in result) continue
      const { resolution } = result
      if (resolution.action === "restore") {
        restoreEntries.push(entry)
        continue
      }

      this.deferredRestoreEntries.delete(entry.windowId)
      discardedBindings.push({
        reason: resolution.reason,
        threadId: resolution.threadId,
        windowId: entry.windowId
      })
    }

    if (discardedBindings.length > 0) {
      if (!this.persistAll()) return
      this.runtime.recordRestoreRepair(
        summarizeDurableWindowRestoreRepairs("thread-window", discardedBindings)
      )
    }

    let resourceRefusalRecorded = false
    if (restoreEntries.length > Math.max(0, this.resourceLimit - this.windows.size)) {
      this.runtime.recordResourceRefusal({
        current: this.windows.size + restoreEntries.length,
        limit: this.resourceLimit
      })
      resourceRefusalRecorded = true
    }

    for (const entry of restoreEntries) {
      await new Promise<void>((resolve) => setImmediate(resolve))
      if (this.restoreGate.isApplicationQuitting()) break
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
      const persistedEntry = this.persistedEntries.get(entry.windowId) ?? entry
      this.windows.delete(entry.windowId)
      this.threadIds.delete(entry.windowId)
      if (!restoreConfirmed || rendererFailed) {
        this.deferredRestoreEntries.set(entry.windowId, persistedEntry)
      }
      this.runtime.onWindowClosed()
      if (!this.restoreGate.isApplicationQuitting()) this.schedulePersist()
    })
  }

  private bindThread(windowId: string, window: BrowserWindow, threadId: string): void {
    const currentThreadId = this.threadIds.get(windowId) ?? null
    if (currentThreadId === threadId) return
    let bindingError: unknown = null
    try {
      this.runtime.setWindowThread(window, threadId)
    } catch (error) {
      bindingError = error
    }

    const authoritativeBinding = this.runtime.getWindowBinding(window)
    if (
      authoritativeBinding.kind === "replaced" ||
      authoritativeBinding.windowId !== windowId ||
      authoritativeBinding.threadId === null
    ) {
      window.destroy()
      throw bindingError ?? new Error("Thread window identity was replaced during thread binding.")
    }
    const authoritativeThreadId = authoritativeBinding.threadId
    if (bindingError === null && authoritativeThreadId !== threadId) {
      bindingError = new Error("Thread window identity did not commit the requested binding.")
    }
    if (bindingError !== null && authoritativeThreadId === currentThreadId) {
      throw bindingError
    }

    this.threadIds.set(windowId, authoritativeThreadId)
    this.persistAll()
    if (!window.webContents.isDestroyed()) {
      window.webContents.send("durable-window:threadChanged", { threadId: authoritativeThreadId })
    }
    if (bindingError !== null) throw bindingError
  }

  private persistAll(): boolean {
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
    return this.persistRestoreEntries([...liveWindows, ...deferredWindows])
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistAll()
    }, PERSIST_DEBOUNCE_MS)
    this.persistTimer.unref()
  }

  private persistRestoreEntries(windows: ThreadWindowRestoreEntry[]): boolean {
    try {
      const persisted = this.runtime.setRestoreState({ version: 1, windows })
      this.replacePersistedEntries(persisted.windows)
      return true
    } catch (error) {
      this.runtime.recordRestoreFailure({ error, windowId: null })
      return false
    }
  }

  private replacePersistedEntries(entries: readonly ThreadWindowRestoreEntry[]): void {
    this.persistedEntries.clear()
    for (const entry of entries) this.persistedEntries.set(entry.windowId, entry)
  }

  private flushPersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.persistAll()
  }
}
