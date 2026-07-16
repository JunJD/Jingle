import type { BrowserWindow, RenderProcessGoneDetails } from "electron"
import { join } from "path"
import { IPC_NETWORK_WINDOW_KIND, type IpcNetworkWindowKind } from "@jingle/devtools-network"
import { APP_THEME_RENDERER_QUERY_KEY, serializeJingleThemeV1 } from "@shared/app-theme"
import type { DurableWindowKind } from "@shared/durable-window"
import { getAppThemeSettings } from "../preferences"

export type AppWindowKind =
  | "main"
  | "launcher"
  | "settings"
  | IpcNetworkWindowKind
  | DurableWindowKind

const SPLASH_WINDOW_KINDS = new Set<AppWindowKind>(["main"])
let rendererWindowShutdownStarted = false

export type RendererWindowLoadFailure =
  | {
      error: unknown
      errorCode?: number
      errorDescription?: string
      phase: "load"
      validatedURL?: string
    }
  | {
      error: unknown
      phase: "preload"
      preloadPath: string
    }
  | {
      details: RenderProcessGoneDetails
      error: unknown
      phase: "renderer-process"
    }

export type RendererWindowLoadFailureObserver = (failure: RendererWindowLoadFailure) => void

export interface StartRendererWindowLoadOptions {
  onFailure: RendererWindowLoadFailureObserver
  query?: Record<string, string>
}

async function loadRendererWindow(
  browserWindow: BrowserWindow,
  windowKind: AppWindowKind,
  query?: Record<string, string>
): Promise<void> {
  if (SPLASH_WINDOW_KINDS.has(windowKind)) {
    await browserWindow.loadFile(join(__dirname, "../../resources/splash.html"))
  }

  const rendererQuery = {
    window: windowKind,
    ...(query ?? {}),
    ...(windowKind === IPC_NETWORK_WINDOW_KIND
      ? {}
      : {
          [APP_THEME_RENDERER_QUERY_KEY]: serializeJingleThemeV1(getAppThemeSettings().config)
        })
  }

  if (process.env["ELECTRON_RENDERER_URL"]) {
    const rendererUrl = new URL(process.env["ELECTRON_RENDERER_URL"])
    rendererUrl.searchParams.set("window", windowKind)
    for (const [key, value] of Object.entries(rendererQuery)) {
      if (key === "window") {
        continue
      }
      rendererUrl.searchParams.set(key, value)
    }
    await browserWindow.loadURL(rendererUrl.toString())
    return
  }

  await browserWindow.loadFile(join(__dirname, "../renderer/index.html"), {
    query: Object.keys(rendererQuery).length > 0 ? rendererQuery : undefined
  })
}

export function beginRendererWindowShutdown(): void {
  rendererWindowShutdownStarted = true
}

export function startRendererWindowLoad(
  browserWindow: BrowserWindow,
  windowKind: AppWindowKind,
  options: StartRendererWindowLoadOptions
): void {
  let terminal = false
  const { onFailure, query } = options

  const destroyFailedWindow = (failure: RendererWindowLoadFailure, reportFailure = true): void => {
    if (terminal || browserWindow.isDestroyed() || rendererWindowShutdownStarted) {
      return
    }

    terminal = true
    browserWindow.destroy()
    if (!reportFailure) {
      return
    }

    try {
      onFailure(failure)
    } catch (observationError) {
      console.error("[window] Failed to observe renderer window failure.", observationError)
    }
  }

  browserWindow.once("closed", () => {
    terminal = true
  })
  browserWindow.webContents.once("preload-error", (_event, preloadPath, error) => {
    destroyFailedWindow({ error, phase: "preload", preloadPath })
  })
  browserWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return
      }

      destroyFailedWindow({
        error: new Error(
          `Renderer navigation failed (${errorCode} ${errorDescription}) for ${validatedURL}.`
        ),
        errorCode,
        errorDescription,
        phase: "load",
        validatedURL
      })
    }
  )
  browserWindow.webContents.once(
    "render-process-gone",
    (_event, details: RenderProcessGoneDetails) => {
      destroyFailedWindow(
        {
          details,
          error: new Error(`Renderer process exited: ${details.reason} (${details.exitCode}).`),
          phase: "renderer-process"
        },
        details.reason !== "clean-exit"
      )
    }
  )

  void loadRendererWindow(browserWindow, windowKind, query).catch((error: unknown) => {
    destroyFailedWindow({ error, phase: "load" })
  })
}
