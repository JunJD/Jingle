import { BrowserWindow, screen, type Rectangle } from "electron"
import { join } from "path"
import { THREAD_WINDOW_KIND } from "@shared/durable-window"
import { attachWindowDiagnostics } from "../diagnostics/electron-events"
import { installExternalWindowOpenHandler } from "./external-window-open"
import { startRendererWindowLoad } from "./load-renderer-window"
import { installWindowPresentation, requestWindowPresentation } from "./window-presentation"
import { registerWindowIdentity } from "./window-identity"

export interface CreateThreadWindowInput {
  bounds?: Rectangle
  isMaximized: boolean
  threadId: string | null
  windowId: string
}

function defaultBounds(): Rectangle {
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.min(1280, Math.max(760, Math.round(workArea.width * 0.82)))
  const height = Math.min(860, Math.max(520, Math.round(workArea.height * 0.82)))
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height
  }
}

function visibleBounds(bounds?: Rectangle): Rectangle {
  if (!bounds) return defaultBounds()
  const { workArea } = screen.getDisplayMatching(bounds)
  const width = Math.min(Math.max(bounds.width, 760), workArea.width)
  const height = Math.min(Math.max(bounds.height, 520), workArea.height)
  return {
    x: Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height),
    width,
    height
  }
}

export function createThreadWindow(input: CreateThreadWindowInput): BrowserWindow {
  const isMac = process.platform === "darwin"
  const window = new BrowserWindow({
    ...visibleBounds(input.bounds),
    minWidth: 760,
    minHeight: 520,
    show: false,
    autoHideMenuBar: !isMac,
    backgroundColor: "#F3F4F1",
    title: "Jingle",
    titleBarStyle: "hidden",
    ...(isMac ? { trafficLightPosition: { x: 16, y: 16 } } : {
      titleBarOverlay: { color: "#F7F6F2", height: 52, symbolColor: "#5F6873" }
    }),
    webPreferences: { preload: join(__dirname, "../preload/index.js"), sandbox: false }
  })
  registerWindowIdentity(window.webContents, {
    kind: THREAD_WINDOW_KIND,
    threadId: input.threadId,
    windowId: input.windowId
  })
  const observeFailure = attachWindowDiagnostics(window, THREAD_WINDOW_KIND)
  window.once("ready-to-show", () => {
    if (input.isMaximized) window.maximize()
  })
  installWindowPresentation(window)
  installExternalWindowOpenHandler(window.webContents)
  startRendererWindowLoad(window, THREAD_WINDOW_KIND, {
    onFailure: observeFailure,
    query: { windowId: input.windowId, ...(input.threadId ? { threadId: input.threadId } : {}) }
  })
  requestWindowPresentation(window)
  return window
}
