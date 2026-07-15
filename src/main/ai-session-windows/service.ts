import type { BrowserWindow, WebContents } from "electron"
import { randomUUID } from "node:crypto"
import {
  PINNED_AI_SESSION_WINDOW_LIMIT,
  type OpenPinnedAiSessionWindowParams,
  type OpenPinnedAiSessionWindowResult,
  type UpdatePinnedAiSessionWindowThreadParams,
  type UpdatePinnedAiSessionWindowThreadResult
} from "@shared/ai-session-window"
import type { PinnedAiSessionWindowRestoreState } from "../preferences"

export interface AiSessionWindowsRuntime {
  canRestorePinnedAiSessionWindow: (threadId: string) => Promise<boolean>
  createPinnedAiSessionWindow: (input: { threadId: string; windowId: string }) => BrowserWindow
  getPinnedAiSessionWindowRestoreState: () => PinnedAiSessionWindowRestoreState
  setPinnedAiSessionWindowRestoreState: (
    state: PinnedAiSessionWindowRestoreState
  ) => PinnedAiSessionWindowRestoreState
  setPinnedAiSessionWindowThreadId: (window: BrowserWindow, threadId: string) => void
}

export class AiSessionWindowsService {
  private readonly pinnedThreadIdsByWindow = new Map<string, string>()
  private readonly pinnedWindows = new Map<string, BrowserWindow>()
  private readonly pinnedWindowIdsByThread = new Map<string, string>()
  private isApplicationQuitting = false

  constructor(private readonly runtime: AiSessionWindowsRuntime) {}

  openPinnedWindow(params: OpenPinnedAiSessionWindowParams): OpenPinnedAiSessionWindowResult {
    const existingWindowId = this.pinnedWindowIdsByThread.get(params.threadId)
    if (existingWindowId !== undefined) {
      const existingWindow = this.pinnedWindows.get(existingWindowId)
      if (existingWindow) {
        this.focusPinnedWindow(existingWindow)
        this.recordPinnedThread(params.threadId)
        return {
          ok: true,
          windowId: existingWindowId
        }
      }
    }

    if (this.pinnedWindows.size >= PINNED_AI_SESSION_WINDOW_LIMIT) {
      return {
        limit: PINNED_AI_SESSION_WINDOW_LIMIT,
        ok: false,
        reason: "limit_reached"
      }
    }

    const windowId = randomUUID()
    const window = this.runtime.createPinnedAiSessionWindow({
      threadId: params.threadId,
      windowId
    })

    this.pinnedWindows.set(windowId, window)
    this.pinnedThreadIdsByWindow.set(windowId, params.threadId)
    this.pinnedWindowIdsByThread.set(params.threadId, windowId)
    this.recordPinnedThread(params.threadId)
    window.once("closed", () => {
      const currentThreadId = this.pinnedThreadIdsByWindow.get(windowId)
      this.pinnedWindows.delete(windowId)
      this.pinnedThreadIdsByWindow.delete(windowId)
      if (currentThreadId && this.pinnedWindowIdsByThread.get(currentThreadId) === windowId) {
        this.pinnedWindowIdsByThread.delete(currentThreadId)
      }

      if (currentThreadId && !this.isApplicationQuitting) {
        this.removePinnedThread(currentThreadId)
      }
    })

    return {
      ok: true,
      windowId
    }
  }

  isPinnedWindowSender(windowId: string, sender: WebContents): boolean {
    const window = this.pinnedWindows.get(windowId)
    return window?.webContents === sender && !sender.isDestroyed()
  }

  updatePinnedWindowThread(
    params: UpdatePinnedAiSessionWindowThreadParams
  ): UpdatePinnedAiSessionWindowThreadResult {
    const window = this.pinnedWindows.get(params.windowId)
    if (!window) {
      throw new Error(`Pinned AI session window "${params.windowId}" is not registered.`)
    }

    const currentThreadId = this.pinnedThreadIdsByWindow.get(params.windowId)
    if (!currentThreadId) {
      throw new Error(`Pinned AI session window "${params.windowId}" is missing its thread.`)
    }

    if (currentThreadId === params.threadId) {
      this.recordPinnedThread(params.threadId)
      return {
        ok: true
      }
    }

    const existingWindowId = this.pinnedWindowIdsByThread.get(params.threadId)
    if (existingWindowId !== undefined && existingWindowId !== params.windowId) {
      const existingWindow = this.pinnedWindows.get(existingWindowId)
      if (existingWindow) {
        this.focusPinnedWindow(existingWindow)
      }
      return {
        ok: false,
        reason: "thread_already_open",
        windowId: existingWindowId
      }
    }

    this.runtime.setPinnedAiSessionWindowThreadId(window, params.threadId)

    if (this.pinnedWindowIdsByThread.get(currentThreadId) === params.windowId) {
      this.pinnedWindowIdsByThread.delete(currentThreadId)
    }
    this.pinnedThreadIdsByWindow.set(params.windowId, params.threadId)
    this.pinnedWindowIdsByThread.set(params.threadId, params.windowId)
    if (!this.isApplicationQuitting) {
      this.replacePinnedThreadRecord(currentThreadId, params.threadId)
    }

    return {
      ok: true
    }
  }

  markApplicationQuitting(): void {
    this.isApplicationQuitting = true
  }

  async restorePinnedWindows(): Promise<void> {
    const { threadIds } = this.runtime.getPinnedAiSessionWindowRestoreState()

    for (const threadId of threadIds) {
      let canRestore: boolean
      try {
        canRestore = await this.runtime.canRestorePinnedAiSessionWindow(threadId)
      } catch (error) {
        console.warn("[AiSessionWindows] Failed to check pinned session window restore target.", {
          error,
          threadId
        })
        continue
      }

      if (!canRestore) {
        console.warn("[AiSessionWindows] Skipping stale pinned session window restore target.", {
          threadId
        })
        this.removePinnedThread(threadId)
        continue
      }

      const result = this.openPinnedWindow({ threadId })
      if (!result.ok) {
        console.warn("[AiSessionWindows] Failed to restore pinned session window.", {
          limit: result.limit,
          reason: result.reason,
          threadId
        })
        this.removePinnedThread(threadId)
      }
    }
  }

  private focusPinnedWindow(window: BrowserWindow): void {
    if (window.isMinimized()) {
      window.restore()
    }

    if (!window.isVisible()) {
      window.show()
    }

    window.focus()
  }

  private recordPinnedThread(threadId: string): void {
    this.updatePinnedWindowRestoreProjection("record", (threadIds) => {
      return threadIds.includes(threadId) ? threadIds : [...threadIds, threadId]
    })
  }

  private removePinnedThread(threadId: string): void {
    this.updatePinnedWindowRestoreProjection("remove", (threadIds) =>
      threadIds.filter((candidate) => candidate !== threadId)
    )
  }

  private replacePinnedThreadRecord(currentThreadId: string, nextThreadId: string): void {
    this.updatePinnedWindowRestoreProjection("replace", (threadIds) => [
      ...threadIds.filter(
        (candidate) => candidate !== currentThreadId && candidate !== nextThreadId
      ),
      nextThreadId
    ])
  }

  private updatePinnedWindowRestoreProjection(
    operation: "record" | "remove" | "replace",
    project: (threadIds: string[]) => string[]
  ): void {
    try {
      const state = this.runtime.getPinnedAiSessionWindowRestoreState()
      const threadIds = project(state.threadIds)
      if (
        threadIds.length === state.threadIds.length &&
        threadIds.every((threadId, index) => threadId === state.threadIds[index])
      ) {
        return
      }
      this.runtime.setPinnedAiSessionWindowRestoreState({ threadIds })
    } catch (error) {
      console.warn("[AiSessionWindows] Failed to update pinned window restore projection.", {
        error,
        operation
      })
    }
  }
}
