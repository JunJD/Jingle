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

export type RendererWindowRecoveryDecision =
  | {
      attempt: 1
      kind: "recover"
    }
  | {
      kind: "terminal"
      reason: "clean-exit" | "non-recoverable" | "recovery-exhausted" | "recovery-failed"
      reportFailure: boolean
    }

const RECOVERABLE_RENDERER_EXIT_REASONS = new Set<RenderProcessGoneDetails["reason"]>([
  "abnormal-exit",
  "crashed",
  "memory-eviction"
])

export function resolveRendererWindowRecoveryDecision(input: {
  failure: RendererWindowLoadFailure
  recoveryAttemptCount: number
}): RendererWindowRecoveryDecision {
  const { failure, recoveryAttemptCount } = input
  if (failure.phase !== "renderer-process") {
    return {
      kind: "terminal",
      reason: recoveryAttemptCount > 0 ? "recovery-failed" : "non-recoverable",
      reportFailure: true
    }
  }

  if (failure.details.reason === "clean-exit") {
    return { kind: "terminal", reason: "clean-exit", reportFailure: false }
  }
  if (recoveryAttemptCount > 0) {
    return { kind: "terminal", reason: "recovery-exhausted", reportFailure: true }
  }
  if (RECOVERABLE_RENDERER_EXIT_REASONS.has(failure.details.reason)) {
    return { attempt: 1, kind: "recover" }
  }
  return { kind: "terminal", reason: "non-recoverable", reportFailure: true }
}

export interface StartRendererWindowLoadOptions {
  onFailure: RendererWindowLoadFailureObserver
  onTerminalFailure?: RendererWindowLoadFailureObserver
  query?: Record<string, string>
}

async function loadRendererWindow(
  browserWindow: BrowserWindow,
  windowKind: AppWindowKind,
  query: Record<string, string> | undefined,
  isCurrent: () => boolean
): Promise<void> {
  if (SPLASH_WINDOW_KINDS.has(windowKind)) {
    await browserWindow.loadFile(join(__dirname, "../../resources/splash.html"))
    if (!isCurrent()) {
      return
    }
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
  let loadGeneration = 0
  let recoveryAttemptCount = 0
  let state: "active" | "closed" | "recovering" | "terminal" = "active"
  const { onFailure, onTerminalFailure, query } = options

  const observeFailure = (failure: RendererWindowLoadFailure): void => {
    try {
      onFailure(failure)
    } catch {
      console.error("[window] Failed to observe renderer window failure.")
    }
  }

  const terminateFailedWindow = (failure: RendererWindowLoadFailure): void => {
    if (
      state === "closed" ||
      state === "terminal" ||
      browserWindow.isDestroyed() ||
      rendererWindowShutdownStarted
    ) {
      return
    }

    state = "terminal"
    loadGeneration += 1
    try {
      onTerminalFailure?.(failure)
    } catch {
      console.error("[window] Failed to observe terminal renderer window failure.")
    }
    browserWindow.destroy()
  }

  const beginLoad = (deferUntilNextTask = false): void => {
    const generation = ++loadGeneration
    const canContinueLoad = (): boolean =>
      generation === loadGeneration &&
      state !== "closed" &&
      state !== "terminal" &&
      !browserWindow.isDestroyed() &&
      !rendererWindowShutdownStarted
    const startLoad = (): void => {
      if (!canContinueLoad()) {
        return
      }
      void loadRendererWindow(browserWindow, windowKind, query, canContinueLoad)
        .then(() => {
          if (generation !== loadGeneration || state === "closed" || state === "terminal") {
            return
          }
          state = "active"
        })
        .catch((error: unknown) => {
          if (generation !== loadGeneration) {
            return
          }
          handleFailure({ error, phase: "load" })
        })
    }
    if (deferUntilNextTask) {
      setImmediate(startLoad)
      return
    }
    startLoad()
  }

  const handleFailure = (failure: RendererWindowLoadFailure): void => {
    if (
      state === "closed" ||
      state === "terminal" ||
      browserWindow.isDestroyed() ||
      rendererWindowShutdownStarted
    ) {
      return
    }

    const decision = resolveRendererWindowRecoveryDecision({ failure, recoveryAttemptCount })
    if (decision.kind === "recover" || decision.reportFailure) {
      observeFailure(failure)
    }
    if (decision.kind === "recover") {
      recoveryAttemptCount = decision.attempt
      state = "recovering"
      beginLoad(true)
      return
    }
    terminateFailedWindow(failure)
  }

  browserWindow.once("closed", () => {
    state = "closed"
    loadGeneration += 1
  })
  browserWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    handleFailure({ error, phase: "preload", preloadPath })
  })
  browserWindow.webContents.on(
    "render-process-gone",
    (_event, details: RenderProcessGoneDetails) => {
      handleFailure({
        details,
        error: new Error(`Renderer process exited: ${details.reason} (${details.exitCode}).`),
        phase: "renderer-process"
      })
    }
  )

  beginLoad()
}
