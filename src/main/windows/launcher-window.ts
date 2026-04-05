import { spawn } from "node:child_process"
import { BrowserWindow, type IpcMain, type Rectangle, screen, shell } from "electron"
import { basename, extname, join } from "path"
import { loadRendererWindow } from "./load-renderer-window"
import {
  FALLBACK_SHELL_CONFIG,
  getLauncherIdleHeight,
  getLauncherMaxViewportHeight
} from "../../shared/launcher"
import type { ClipboardContext } from "../../shared/clipboard"
import {
  createLauncherHistoryKey,
  type RecordLauncherHistoryItemInput
} from "../../shared/launcher-history"
import type {
  LauncherActionExecutor,
  LauncherOpenPathTarget,
  LauncherSearchAction,
  LauncherSearchRequest
} from "../../shared/launcher-search"
import { readClipboardContext } from "../services/clipboard"
import { recordLauncherHistoryItem } from "../services/launcher-history"
import { getLocalStartItem, recordLocalStartItemUse } from "../services/local-start"
import { getApplicationIconDataUrl } from "../services/launcher-search/providers/applications"
import { searchLauncher } from "../services/launcher-search"

const LAUNCHER_WIDTH = 760
const LAUNCHER_HORIZONTAL_MARGIN = 24
const LAUNCHER_TOP_MARGIN = 60
const LAUNCHER_VERTICAL_POSITION_RATIO = 0.28
const MAC_LAUNCHER_WINDOW_LEVEL = "floating"
const LAUNCHER_BASE_HEIGHT = getLauncherIdleHeight(FALLBACK_SHELL_CONFIG)
const LAUNCHER_MAX_HEIGHT = getLauncherMaxViewportHeight(FALLBACK_SHELL_CONFIG)
const LAUNCHER_MAX_SCREEN_HEIGHT_RATIO = 0.7
const WINDOWS_LAUNCHER_SHAPE_RADIUS = 12
const EMPTY_CLIPBOARD_CONTEXT: ClipboardContext = { kind: "none" }
const launcherVisibleOrigins = new WeakMap<BrowserWindow, { x: number; y: number }>()
let launcherBlurHideSuppressionDepth = 0

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getLauncherBounds(height = LAUNCHER_BASE_HEIGHT): Rectangle {
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const boundedHeight = getLauncherHeightForDisplay(display, height)
  const maxWidth = Math.max(520, display.workArea.width - LAUNCHER_HORIZONTAL_MARGIN * 2)
  const width = Math.min(LAUNCHER_WIDTH, maxWidth)
  const x = Math.round(display.workArea.x + display.workArea.width / 2 - width / 2)
  const minY = display.workArea.y + LAUNCHER_TOP_MARGIN
  const maxY = display.workArea.y + display.workArea.height - boundedHeight - LAUNCHER_TOP_MARGIN
  const targetY = Math.round(minY + (maxY - minY) * LAUNCHER_VERTICAL_POSITION_RATIO)
  const y = clamp(targetY, minY, Math.max(minY, maxY))

  return {
    x,
    y,
    width,
    height: boundedHeight
  }
}

function getLauncherHeightForDisplay(display: Electron.Display, requestedHeight: number): number {
  const maxHeightByScreen = Math.floor(display.workArea.height * LAUNCHER_MAX_SCREEN_HEIGHT_RATIO)
  const maxHeight = Math.max(LAUNCHER_BASE_HEIGHT, Math.min(LAUNCHER_MAX_HEIGHT, maxHeightByScreen))

  return clamp(Math.round(requestedHeight), LAUNCHER_BASE_HEIGHT, maxHeight)
}

function getVisibleLauncherBounds(params: {
  anchorX: number
  anchorY: number
  height: number
  launcherWindow: BrowserWindow
}): Rectangle {
  const { anchorX, anchorY, height, launcherWindow } = params
  const currentBounds = launcherWindow.getBounds()
  const display = screen.getDisplayMatching(currentBounds)
  const boundedHeight = getLauncherHeightForDisplay(display, height)
  const minX = display.workArea.x + LAUNCHER_HORIZONTAL_MARGIN
  const maxX =
    display.workArea.x + display.workArea.width - currentBounds.width - LAUNCHER_HORIZONTAL_MARGIN
  const minY = display.workArea.y + LAUNCHER_TOP_MARGIN
  const maxY = display.workArea.y + display.workArea.height - boundedHeight - LAUNCHER_TOP_MARGIN

  return {
    x: clamp(anchorX, minX, Math.max(minX, maxX)),
    y: clamp(anchorY, minY, Math.max(minY, maxY)),
    width: currentBounds.width,
    height: boundedHeight
  }
}

function buildRoundedRectShape(width: number, height: number, radius: number): Rectangle[] {
  if (width <= 0 || height <= 0) {
    return []
  }

  const boundedRadius = clamp(Math.round(radius), 0, Math.floor(Math.min(width, height) / 2))
  if (boundedRadius === 0) {
    return [{ x: 0, y: 0, width, height }]
  }

  const rects: Rectangle[] = []
  let currentRect: Rectangle | null = null

  for (let y = 0; y < height; y += 1) {
    const topDy = Math.max(0, boundedRadius - (y + 0.5))
    const bottomDy = Math.max(0, y + 0.5 - (height - boundedRadius))
    const cornerDy = Math.max(topDy, bottomDy)
    const inset =
      cornerDy > 0
        ? Math.max(
            0,
            Math.ceil(
              boundedRadius - Math.sqrt(boundedRadius * boundedRadius - cornerDy * cornerDy)
            )
          )
        : 0
    const lineWidth = Math.max(1, width - inset * 2)
    const lineX = inset

    if (
      currentRect &&
      currentRect.x === lineX &&
      currentRect.width === lineWidth &&
      currentRect.y + currentRect.height === y
    ) {
      currentRect.height += 1
      continue
    }

    currentRect = { x: lineX, y, width: lineWidth, height: 1 }
    rects.push(currentRect)
  }

  return rects
}

function syncLauncherWindowShape(launcherWindow: BrowserWindow): void {
  if (process.platform !== "win32" || launcherWindow.isDestroyed()) {
    return
  }

  const { width, height } = launcherWindow.getBounds()
  launcherWindow.setShape(buildRoundedRectShape(width, height, WINDOWS_LAUNCHER_SHAPE_RADIUS))
}

function setLauncherWindowBounds(launcherWindow: BrowserWindow, bounds: Rectangle): void {
  launcherWindow.setBounds(bounds, false)
  syncLauncherWindowShape(launcherWindow)
}

function emitLauncherShown(launcherWindow: BrowserWindow): void {
  if (launcherWindow.webContents.isLoadingMainFrame()) {
    launcherWindow.webContents.once("did-finish-load", () => {
      if (!launcherWindow.isDestroyed()) {
        launcherWindow.webContents.send("launcher:shown")
      }
    })
    return
  }

  launcherWindow.webContents.send("launcher:shown")
}

export function showLauncherWindow(launcherWindow: BrowserWindow): void {
  const nextHeight = launcherWindow.getBounds().height || LAUNCHER_BASE_HEIGHT
  const nextBounds = getLauncherBounds(nextHeight)
  setLauncherWindowBounds(launcherWindow, nextBounds)

  if (process.platform === "darwin") {
    launcherWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    //// 保持启动器位于应用窗口上方，但不遮挡输入法候选窗口。
    launcherWindow.setAlwaysOnTop(true, MAC_LAUNCHER_WINDOW_LEVEL)
  } else {
    launcherWindow.setAlwaysOnTop(true)
  }

  launcherWindow.show()
  launcherWindow.focus()
  launcherWindow.moveTop()
  emitLauncherShown(launcherWindow)

  if (process.platform === "darwin") {
    setTimeout(() => {
      if (!launcherWindow.isDestroyed() && launcherWindow.isVisible()) {
        launcherWindow.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: true })
      }
    }, 0)
  }
}

function hideLauncherWindow(launcherWindow: BrowserWindow): void {
  launcherWindow.hide()
}

export function setLauncherBlurHideSuppressed(active: boolean): void {
  if (active) {
    launcherBlurHideSuppressionDepth += 1
    return
  }

  launcherBlurHideSuppressionDepth = Math.max(0, launcherBlurHideSuppressionDepth - 1)
}

async function openLauncherPath(
  path: string,
  kind: "application" | "file" | "directory"
): Promise<void> {
  if (kind === "application" && process.platform === "darwin") {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("open", [path], {
        detached: true,
        stdio: "ignore"
      })

      child.once("error", reject)
      child.once("spawn", () => resolve())
      child.unref()
    })
    return
  }

  const openPathError = await shell.openPath(path)
  if (openPathError) {
    throw new Error(openPathError)
  }
}

async function openLauncherUrl(url: string): Promise<void> {
  await shell.openExternal(url)
}

function getLauncherPathTitle(target: LauncherOpenPathTarget): string {
  const fileName = basename(target.path)
  if (target.kind === "application") {
    const fileExtension = extname(fileName)
    return fileExtension ? basename(fileName, fileExtension) : fileName
  }

  return fileName
}

function getLauncherPathHistoryKey(target: LauncherOpenPathTarget): string {
  if (target.kind === "application") {
    return createLauncherHistoryKey({
      path: target.path,
      type: "application"
    })
  }

  if (target.kind === "file") {
    return createLauncherHistoryKey({
      path: target.path,
      type: "file"
    })
  }

  return createLauncherHistoryKey({
    path: target.path,
    type: "directory"
  })
}

async function buildLauncherHistoryRecord(
  action: LauncherSearchAction
): Promise<RecordLauncherHistoryItemInput | null> {
  switch (action.type) {
    case "open-path":
      if (!action.localStartItemId) {
        return {
          action,
          historyKey: getLauncherPathHistoryKey(action.target),
          iconDataUrl:
            action.target.kind === "application"
              ? await getApplicationIconDataUrl(action.target.path)
              : undefined,
          kind: action.target.kind,
          subtitle: action.target.path,
          title: getLauncherPathTitle(action.target)
        }
      }

      {
        const item = getLocalStartItem(action.localStartItemId)
        const itemKind = item?.kind ?? action.target.kind
        const itemPath = item?.path ?? action.target.path
        return {
          action,
          historyKey: createLauncherHistoryKey({
            itemId: action.localStartItemId,
            type: "local-start"
          }),
          iconDataUrl:
            itemKind === "application" ? await getApplicationIconDataUrl(itemPath) : undefined,
          kind: itemKind,
          subtitle: itemPath,
          title:
            item?.title ??
            getLauncherPathTitle({
              kind: action.target.kind,
              path: action.target.path
            })
        }
      }
    case "open-url":
    case "none":
      return null
    default: {
      const exhaustiveAction: never = action
      throw new Error(`Unsupported launcher history action: ${JSON.stringify(exhaustiveAction)}`)
    }
  }
}

type LauncherActionExecutorHandler = (action: LauncherSearchAction) => Promise<void>

const launcherActionExecutors: Record<LauncherActionExecutor, LauncherActionExecutorHandler> = {
  internal: async (action) => {
    if (action.type !== "none") {
      throw new Error(`Unsupported internal launcher action: ${JSON.stringify(action)}`)
    }
  },
  shell: async (action) => {
    switch (action.type) {
      case "open-path":
        await openLauncherPath(action.target.path, action.target.kind)
        return
      case "open-url":
        await openLauncherUrl(action.target.url)
        return
      default:
        throw new Error(`Unsupported shell launcher action: ${JSON.stringify(action)}`)
    }
  }
}

async function applyLauncherActionSideEffects(action: LauncherSearchAction): Promise<void> {
  switch (action.type) {
    case "open-path": {
      if (action.localStartItemId) {
        recordLocalStartItemUse(action.localStartItemId)
      }

      const historyRecord = await buildLauncherHistoryRecord(action)
      if (historyRecord) {
        recordLauncherHistoryItem(historyRecord)
      }
      return
    }
    case "open-url":
    case "none":
      return
    default: {
      const exhaustiveAction: never = action
      throw new Error(
        `Unsupported launcher side effects action: ${JSON.stringify(exhaustiveAction)}`
      )
    }
  }
}

async function executeLauncherAction(action: LauncherSearchAction): Promise<void> {
  await launcherActionExecutors[action.executor](action)
  await applyLauncherActionSideEffects(action)
}

export function createLauncherWindow(): BrowserWindow {
  const launcherWindow = new BrowserWindow({
    width: LAUNCHER_WIDTH,
    height: LAUNCHER_BASE_HEIGHT,
    show: false,
    autoHideMenuBar: process.platform !== "darwin",
    ...(process.platform === "darwin"
      ? {
          type: "panel" as const,
          vibrancy: "popover" as const,
          visualEffectState: "active" as const
        }
      : {}),
    ...(process.platform === "win32"
      ? {
          backgroundMaterial: "none" as const,
          hasShadow: false,
          roundedCorners: true
        }
      : {
          hasShadow: true
        }),
    frame: false,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  })

  launcherWindow.on("blur", () => {
    if (launcherBlurHideSuppressionDepth > 0) {
      return
    }

    if (!launcherWindow.isDestroyed() && launcherWindow.isVisible()) {
      hideLauncherWindow(launcherWindow)
    }
  })

  launcherWindow.on("resize", () => {
    syncLauncherWindowShape(launcherWindow)
  })

  launcherWindow.on("show", () => {
    const { x, y } = launcherWindow.getBounds()
    launcherVisibleOrigins.set(launcherWindow, { x, y })
  })

  launcherWindow.on("hide", () => {
    launcherVisibleOrigins.delete(launcherWindow)
  })

  launcherWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape") {
      event.preventDefault()
      hideLauncherWindow(launcherWindow)
    }
  })

  const repositionIfVisible = (): void => {
    if (!launcherWindow.isDestroyed() && launcherWindow.isVisible()) {
      const nextBounds = getLauncherBounds(launcherWindow.getBounds().height)
      launcherVisibleOrigins.set(launcherWindow, {
        x: nextBounds.x,
        y: nextBounds.y
      })
      setLauncherWindowBounds(launcherWindow, nextBounds)
    }
  }

  screen.on("display-metrics-changed", repositionIfVisible)
  screen.on("display-added", repositionIfVisible)
  screen.on("display-removed", repositionIfVisible)

  launcherWindow.on("closed", () => {
    screen.removeListener("display-metrics-changed", repositionIfVisible)
    screen.removeListener("display-added", repositionIfVisible)
    screen.removeListener("display-removed", repositionIfVisible)
  })

  syncLauncherWindowShape(launcherWindow)
  void loadRendererWindow(launcherWindow, "launcher")

  return launcherWindow
}

export function registerLauncherHandlers(ipcMain: IpcMain): void {
  ipcMain.handle("launcher:search", async (_event, request: LauncherSearchRequest) => {
    return searchLauncher(request)
  })

  ipcMain.handle("launcher:getClipboardContext", (): ClipboardContext => {
    if (process.env.OPENWORK_BDD === "1") {
      return EMPTY_CLIPBOARD_CONTEXT
    }

    return readClipboardContext()
  })

  ipcMain.handle("launcher:executeAction", async (event, action: LauncherSearchAction) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender)

    try {
      await executeLauncherAction(action)
      currentWindow?.hide()
      return {
        ok: true
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false
      }
    }
  })

  ipcMain.handle("launcher:hide", (event) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender)
    currentWindow?.hide()
  })

  ipcMain.handle("launcher:show", (event) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender)
    if (!currentWindow) {
      return
    }

    showLauncherWindow(currentWindow)
  })

  ipcMain.handle("launcher:setViewportHeight", (event, height: number) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender)
    if (!currentWindow) {
      return
    }
    const visibleOrigin = launcherVisibleOrigins.get(currentWindow)

    setLauncherWindowBounds(
      currentWindow,
      currentWindow.isVisible()
        ? getVisibleLauncherBounds({
            anchorX: visibleOrigin?.x ?? currentWindow.getBounds().x,
            anchorY: visibleOrigin?.y ?? currentWindow.getBounds().y,
            height,
            launcherWindow: currentWindow
          })
        : getLauncherBounds(height)
    )
  })
}
