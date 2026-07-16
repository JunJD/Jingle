import { EventEmitter } from "node:events"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { BrowserWindow, RenderProcessGoneDetails } from "electron"
import {
  attachWindowDiagnosticsWithLogger,
  type WindowDiagnosticsLogger
} from "../../src/main/diagnostics/window-events"
import {
  beginRendererWindowShutdown,
  startRendererWindowLoad
} from "../../src/main/windows/load-renderer-window"
import {
  installWindowPresentation,
  requestWindowPresentation
} from "../../src/main/windows/window-presentation"

let nextWindowId = 1

class FakeWebContents extends EventEmitter {
  readonly id: number

  constructor(id: number) {
    super()
    this.id = id
  }

  getURL(): string {
    return "file://app"
  }
}

interface DiagnosticRecord {
  fields: object | undefined
  level: "error" | "info" | "warn"
  message: string
}

class FakeDiagnosticsLogger implements WindowDiagnosticsLogger {
  readonly records: DiagnosticRecord[] = []

  error(message: string, fields?: object): void {
    this.records.push({ fields, level: "error", message })
  }

  info(message: string, fields?: object): void {
    this.records.push({ fields, level: "info", message })
  }

  warn(message: string, fields?: object): void {
    this.records.push({ fields, level: "warn", message })
  }

  get errorMessages(): string[] {
    return this.records.filter(({ level }) => level === "error").map(({ message }) => message)
  }
}

class FakeBrowserWindow extends EventEmitter {
  readonly id = nextWindowId++
  destroyCount = 0
  focusCount = 0
  loadFilePromise: Promise<void> = new Promise(() => undefined)
  minimized = false
  restoreCount = 0
  showCount = 0
  visible = false
  readonly webContents = new FakeWebContents(this.id + 10_000)

  destroy(): void {
    if (this.destroyCount > 0) {
      return
    }
    this.destroyCount += 1
    this.emit("closed")
  }

  focus(): void {
    this.focusCount += 1
  }

  isDestroyed(): boolean {
    return this.destroyCount > 0
  }

  isMinimized(): boolean {
    return this.minimized
  }

  isVisible(): boolean {
    return this.visible
  }

  loadFile(): Promise<void> {
    return this.loadFilePromise
  }

  loadURL(): Promise<void> {
    return this.loadFilePromise
  }

  restore(): void {
    this.minimized = false
    this.restoreCount += 1
  }

  show(): void {
    this.visible = true
    this.showCount += 1
  }
}

function asBrowserWindow(window: FakeBrowserWindow): BrowserWindow {
  return window as unknown as BrowserWindow
}

function startLoad(
  window: FakeBrowserWindow,
  options: {
    logger?: FakeDiagnosticsLogger
  } = {}
): FakeDiagnosticsLogger {
  const logger = options.logger ?? new FakeDiagnosticsLogger()
  const onFailure = attachWindowDiagnosticsWithLogger(asBrowserWindow(window), "settings", logger)
  startRendererWindowLoad(asBrowserWindow(window), "settings", { onFailure })
  return logger
}

describe("window presentation", () => {
  it("waits for first paint and presents an early request exactly once", () => {
    const window = new FakeBrowserWindow()
    installWindowPresentation(asBrowserWindow(window))
    installWindowPresentation(asBrowserWindow(window))
    requestWindowPresentation(asBrowserWindow(window))

    window.webContents.emit("did-finish-load")
    assert.deepEqual([window.showCount, window.focusCount], [0, 0])

    window.emit("ready-to-show")
    window.emit("ready-to-show")
    assert.deepEqual([window.showCount, window.focusCount], [1, 1])
  })

  it("presents a request made after first paint", () => {
    const window = new FakeBrowserWindow()
    installWindowPresentation(asBrowserWindow(window))
    window.emit("ready-to-show")

    requestWindowPresentation(asBrowserWindow(window))

    assert.deepEqual([window.showCount, window.focusCount], [1, 1])
  })

  it("restores minimized windows and does not reshow visible windows", () => {
    const window = new FakeBrowserWindow()
    installWindowPresentation(asBrowserWindow(window))
    window.emit("ready-to-show")
    window.minimized = true

    requestWindowPresentation(asBrowserWindow(window))
    requestWindowPresentation(asBrowserWindow(window))

    assert.deepEqual([window.restoreCount, window.showCount, window.focusCount], [1, 1, 2])
  })

  it("rejects installation and presentation for destroyed windows", () => {
    const destroyedBeforeInstall = new FakeBrowserWindow()
    destroyedBeforeInstall.destroy()
    assert.throws(
      () => installWindowPresentation(asBrowserWindow(destroyedBeforeInstall)),
      /destroyed window/
    )

    const destroyedBeforeRequest = new FakeBrowserWindow()
    installWindowPresentation(asBrowserWindow(destroyedBeforeRequest))
    destroyedBeforeRequest.destroy()
    assert.throws(
      () => requestWindowPresentation(asBrowserWindow(destroyedBeforeRequest)),
      /destroyed window/
    )
  })
})

describe("renderer window load lifecycle", () => {
  it("destroys a pending presentation after a main-frame load failure exactly once", async () => {
    const window = new FakeBrowserWindow()
    let rejectLoad: (error: Error) => void = () => undefined
    window.loadFilePromise = new Promise((_, reject) => {
      rejectLoad = reject
    })
    installWindowPresentation(asBrowserWindow(window))
    requestWindowPresentation(asBrowserWindow(window))
    const logger = startLoad(window)

    window.webContents.emit("did-fail-load", {}, -105, "NAME_NOT_RESOLVED", "file://app", true)
    rejectLoad(new Error("late load rejection"))
    await Promise.resolve()

    assert.equal(window.destroyCount, 1)
    assert.deepEqual(logger.errorMessages, ["Renderer load failed"])
    assert.throws(() => requestWindowPresentation(asBrowserWindow(window)), /destroyed window/)
  })

  it("ignores subframe load failures", () => {
    const window = new FakeBrowserWindow()
    const logger = startLoad(window)

    window.webContents.emit("did-fail-load", {}, -105, "failure", "file://frame", false)

    assert.equal(window.destroyCount, 0)
    assert.deepEqual(logger.errorMessages, [])
  })

  it("destroys an aborted main-frame load", () => {
    const window = new FakeBrowserWindow()
    const logger = startLoad(window)

    window.webContents.emit("did-fail-load", {}, -3, "aborted", "file://app", true)

    assert.equal(window.destroyCount, 1)
    assert.deepEqual(logger.errorMessages, ["Renderer load failed"])
  })

  it("destroys the window after a preload failure", () => {
    const window = new FakeBrowserWindow()
    const logger = startLoad(window)

    window.webContents.emit("preload-error", {}, "preload.js", new Error("preload failed"))

    assert.equal(window.destroyCount, 1)
    assert.deepEqual(logger.errorMessages, ["Preload script failed"])
  })

  it("destroys the window after an abnormal renderer exit", () => {
    const window = new FakeBrowserWindow()
    const logger = startLoad(window)

    window.webContents.emit("render-process-gone", {}, {
      exitCode: 9,
      reason: "crashed"
    } satisfies RenderProcessGoneDetails)

    assert.equal(window.destroyCount, 1)
    assert.deepEqual(logger.errorMessages, ["Renderer process gone"])
  })

  it("keeps cleanup exact-once when the diagnostics observer throws", () => {
    const window = new FakeBrowserWindow()
    const logger = new FakeDiagnosticsLogger()
    logger.error = () => {
      throw new Error("diagnostics unavailable")
    }
    startLoad(window, { logger })

    const fallbackErrors: unknown[][] = []
    const originalConsoleError = console.error
    console.error = (...args: unknown[]) => fallbackErrors.push(args)
    try {
      assert.doesNotThrow(() => {
        window.webContents.emit("preload-error", {}, "preload.js", new Error("preload failed"))
      })
    } finally {
      console.error = originalConsoleError
    }
    assert.equal(window.destroyCount, 1)
    assert.equal(fallbackErrors.length, 1)
  })

  it("closes a clean renderer exit without reporting a failure", () => {
    const window = new FakeBrowserWindow()
    const logger = startLoad(window)

    window.webContents.emit("render-process-gone", {}, {
      exitCode: 0,
      reason: "clean-exit"
    } satisfies RenderProcessGoneDetails)

    assert.equal(window.destroyCount, 1)
    assert.deepEqual(logger.errorMessages, [])
  })

  it("does not report or destroy renderer exits during application shutdown", async () => {
    const window = new FakeBrowserWindow()
    let rejectLoad: (error: Error) => void = () => undefined
    window.loadFilePromise = new Promise((_, reject) => {
      rejectLoad = reject
    })
    beginRendererWindowShutdown()
    const logger = startLoad(window)

    window.webContents.emit("preload-error", {}, "preload.js", new Error("shutdown"))
    window.webContents.emit("render-process-gone", {}, {
      exitCode: 9,
      reason: "killed"
    } satisfies RenderProcessGoneDetails)
    rejectLoad(new Error("shutdown load rejection"))
    await Promise.resolve()

    assert.equal(window.destroyCount, 0)
    assert.deepEqual(logger.errorMessages, [])
  })
})
