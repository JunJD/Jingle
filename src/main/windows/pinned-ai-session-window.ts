import { BrowserWindow, type WebContents } from "electron"
import { join } from "path"
import { PINNED_AI_SESSION_WINDOW_KIND } from "@shared/ai-session-window"
import { installExternalWindowOpenHandler } from "./external-window-open"
import { startRendererWindowLoad } from "./load-renderer-window"
import { lockFixedWindowZoom } from "./window-zoom"
import { attachWindowDiagnostics } from "../diagnostics/electron-events"
import { installWindowPresentation, requestWindowPresentation } from "./window-presentation"

const PINNED_AI_SESSION_WINDOW_WIDTH = 1040
const PINNED_AI_SESSION_WINDOW_HEIGHT = 640
const PINNED_AI_SESSION_WINDOW_MIN_WIDTH = 560
const PINNED_AI_SESSION_WINDOW_MIN_HEIGHT = 420
const pinnedAiSessionWindowThreads = new WeakMap<WebContents, string>()

export function isPinnedAiSessionWindowWebContents(webContents: WebContents): boolean {
  return getPinnedAiSessionWindowThreadId(webContents) !== null
}

export function getPinnedAiSessionWindowThreadId(webContents: WebContents): string | null {
  if (webContents.isDestroyed()) {
    return null
  }

  return pinnedAiSessionWindowThreads.get(webContents) ?? null
}

export function setPinnedAiSessionWindowThreadId(webContents: WebContents, threadId: string): void {
  if (webContents.isDestroyed() || !pinnedAiSessionWindowThreads.has(webContents)) {
    throw new Error("Pinned AI session window is not available for thread reassignment.")
  }

  pinnedAiSessionWindowThreads.set(webContents, threadId)
}

export interface CreatePinnedAiSessionWindowInput {
  threadId: string
  windowId: string
}

export function createPinnedAiSessionWindow(
  input: CreatePinnedAiSessionWindowInput
): BrowserWindow {
  const isMac = process.platform === "darwin"
  const window = new BrowserWindow({
    width: PINNED_AI_SESSION_WINDOW_WIDTH,
    height: PINNED_AI_SESSION_WINDOW_HEIGHT,
    minWidth: PINNED_AI_SESSION_WINDOW_MIN_WIDTH,
    minHeight: PINNED_AI_SESSION_WINDOW_MIN_HEIGHT,
    show: false,
    autoHideMenuBar: !isMac,
    backgroundColor: "#F3F4F1",
    title: "Jingle",
    titleBarStyle: "hidden",
    ...(isMac
      ? {
          trafficLightPosition: { x: 16, y: 16 }
        }
      : {
          titleBarOverlay: {
            color: "#F7F6F2",
            height: 32,
            symbolColor: "#5F6873"
          }
        }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  })
  pinnedAiSessionWindowThreads.set(window.webContents, input.threadId)

  const observeRendererWindowLoadFailure = attachWindowDiagnostics(
    window,
    PINNED_AI_SESSION_WINDOW_KIND
  )
  lockFixedWindowZoom(window)
  installWindowPresentation(window)

  installExternalWindowOpenHandler(window.webContents)

  startRendererWindowLoad(window, PINNED_AI_SESSION_WINDOW_KIND, {
    onFailure: observeRendererWindowLoadFailure,
    query: {
      pinnedWindowId: input.windowId,
      threadId: input.threadId
    }
  })
  requestWindowPresentation(window)

  return window
}
