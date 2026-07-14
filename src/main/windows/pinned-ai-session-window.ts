import { BrowserWindow, type WebContents } from "electron"
import { join } from "path"
import { PINNED_AI_SESSION_WINDOW_KIND } from "@shared/ai-session-window"
import { installExternalWindowOpenHandler } from "./external-window-open"
import { loadRendererWindow } from "./load-renderer-window"
import { lockFixedWindowZoom } from "./window-zoom"
import { attachWindowDiagnostics } from "../diagnostics/electron-events"

const PINNED_AI_SESSION_WINDOW_WIDTH = 1040
const PINNED_AI_SESSION_WINDOW_HEIGHT = 640
const PINNED_AI_SESSION_WINDOW_MIN_WIDTH = 560
const PINNED_AI_SESSION_WINDOW_MIN_HEIGHT = 420
const pinnedAiSessionWindowWebContents = new WeakSet<WebContents>()

export function isPinnedAiSessionWindowWebContents(webContents: WebContents): boolean {
  return pinnedAiSessionWindowWebContents.has(webContents) && !webContents.isDestroyed()
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
  pinnedAiSessionWindowWebContents.add(window.webContents)

  attachWindowDiagnostics(window, PINNED_AI_SESSION_WINDOW_KIND)
  lockFixedWindowZoom(window)

  window.on("ready-to-show", () => {
    window.show()
    window.focus()
  })

  installExternalWindowOpenHandler(window.webContents)

  void loadRendererWindow(window, PINNED_AI_SESSION_WINDOW_KIND, {
    pinnedWindowId: input.windowId,
    threadId: input.threadId
  })

  return window
}
