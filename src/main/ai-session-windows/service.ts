import type { BrowserWindow } from "electron"
import { randomUUID } from "node:crypto"
import {
  PINNED_AI_SESSION_WINDOW_LIMIT,
  type OpenPinnedAiSessionWindowParams,
  type OpenPinnedAiSessionWindowResult
} from "@shared/ai-session-window"

export interface AiSessionWindowsRuntime {
  createPinnedAiSessionWindow: (input: { threadId: string; windowId: string }) => BrowserWindow
}

export class AiSessionWindowsService {
  private readonly pinnedWindows = new Map<string, BrowserWindow>()

  constructor(private readonly runtime: AiSessionWindowsRuntime) {}

  openPinnedWindow(params: OpenPinnedAiSessionWindowParams): OpenPinnedAiSessionWindowResult {
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
    window.once("closed", () => {
      this.pinnedWindows.delete(windowId)
    })

    return {
      ok: true,
      windowId
    }
  }
}
