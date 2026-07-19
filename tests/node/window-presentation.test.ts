import { EventEmitter } from "node:events"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { BrowserWindow, RenderProcessGoneDetails } from "electron"
import {
  attachWindowDiagnosticsWithLogger,
  type WindowDiagnosticsLogger
} from "../../src/main/diagnostics/window-events"
import type {
  DiagnosticGraphEventInput,
  DiagnosticGraphSink
} from "../../src/main/diagnostics/schema"
import {
  type AppWindowKind,
  beginRendererWindowShutdown,
  resolveRendererWindowRecoveryDecision,
  startRendererWindowLoad,
  type StartRendererWindowLoadOptions
} from "../../src/main/windows/load-renderer-window"
import type { RendererWindowLoadFailure } from "../../src/main/windows/load-renderer-window"
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

class FakeDiagnosticGraph implements DiagnosticGraphSink {
  readonly inputs: DiagnosticGraphEventInput[] = []

  capture(input: DiagnosticGraphEventInput) {
    this.inputs.push(input)
    return {
      eventId: `event-${this.inputs.length}`,
      sequence: this.inputs.length,
      sessionId: "test"
    }
  }
}

class FakeBrowserWindow extends EventEmitter {
  readonly id = nextWindowId++
  destroyCount = 0
  focusCount = 0
  loadFileCount = 0
  loadFileQueries: Array<Record<string, string> | undefined> = []
  loadFilePromise: Promise<void> = new Promise(() => undefined)
  loadFileResults: Promise<void>[] = []
  minimized = false
  restoreCount = 0
  showCount = 0
  showInactiveCount = 0
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

  loadFile(_filePath: string, options?: { query?: Record<string, string> }): Promise<void> {
    this.loadFileCount += 1
    this.loadFileQueries.push(options?.query)
    return this.loadFileResults.shift() ?? this.loadFilePromise
  }

  loadURL(): Promise<void> {
    this.loadFileCount += 1
    return this.loadFileResults.shift() ?? this.loadFilePromise
  }

  restore(): void {
    this.minimized = false
    this.restoreCount += 1
  }

  show(): void {
    this.visible = true
    this.showCount += 1
  }

  showInactive(): void {
    this.visible = true
    this.showInactiveCount += 1
  }
}

function asBrowserWindow(window: FakeBrowserWindow): BrowserWindow {
  return window as unknown as BrowserWindow
}

function startLoad(
  window: FakeBrowserWindow,
  options: {
    logger?: FakeDiagnosticsLogger
    graph?: DiagnosticGraphSink
    onTerminalFailure?: () => void
    query?: StartRendererWindowLoadOptions["query"]
    windowKind?: AppWindowKind
  } = {}
): FakeDiagnosticsLogger {
  const logger = options.logger ?? new FakeDiagnosticsLogger()
  const windowKind = options.windowKind ?? "settings"
  const onFailure = attachWindowDiagnosticsWithLogger(
    asBrowserWindow(window),
    windowKind,
    logger,
    options.graph
  )
  startRendererWindowLoad(asBrowserWindow(window), windowKind, {
    onFailure,
    onTerminalFailure: options.onTerminalFailure,
    query: options.query
  })
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

  it("shows a restored window without taking activation", () => {
    const window = new FakeBrowserWindow()
    installWindowPresentation(asBrowserWindow(window))
    requestWindowPresentation(asBrowserWindow(window), { activate: false })

    window.emit("ready-to-show")

    assert.deepEqual([window.showInactiveCount, window.showCount, window.focusCount], [1, 0, 0])
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
  const rendererFailure = (
    reason: RenderProcessGoneDetails["reason"]
  ): RendererWindowLoadFailure => ({
    details: { exitCode: reason === "clean-exit" ? 0 : 9, reason },
    error: new Error(`renderer ${reason}`),
    phase: "renderer-process"
  })

  it("classifies one recoverable renderer exit and fails closed for unsafe reasons", () => {
    for (const reason of ["abnormal-exit", "crashed", "memory-eviction"] as const) {
      assert.deepEqual(
        resolveRendererWindowRecoveryDecision({
          failure: rendererFailure(reason),
          recoveryAttemptCount: 0
        }),
        { attempt: 1, kind: "recover" }
      )
    }

    for (const reason of ["integrity-failure", "killed", "launch-failed", "oom"] as const) {
      assert.deepEqual(
        resolveRendererWindowRecoveryDecision({
          failure: rendererFailure(reason),
          recoveryAttemptCount: 0
        }),
        { kind: "terminal", reason: "non-recoverable", reportFailure: true }
      )
    }
    assert.deepEqual(
      resolveRendererWindowRecoveryDecision({
        failure: rendererFailure("crashed"),
        recoveryAttemptCount: 1
      }),
      { kind: "terminal", reason: "recovery-exhausted", reportFailure: true }
    )
  })

  it("reports a terminal renderer failure before closing its window", () => {
    const window = new FakeBrowserWindow()
    const order: string[] = []
    window.once("closed", () => order.push("closed"))
    startLoad(window, { onTerminalFailure: () => order.push("failure") })

    window.webContents.emit("preload-error", {}, "preload.js", new Error("preload failed"))

    assert.deepEqual(order, ["failure", "closed"])
  })

  it("destroys a pending presentation after its managed load rejects exactly once", async () => {
    const window = new FakeBrowserWindow()
    let rejectLoad: (error: Error) => void = () => undefined
    window.loadFilePromise = new Promise((_, reject) => {
      rejectLoad = reject
    })
    installWindowPresentation(asBrowserWindow(window))
    requestWindowPresentation(asBrowserWindow(window))
    const logger = startLoad(window)

    rejectLoad(new Error("managed load rejection"))
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.equal(window.destroyCount, 1)
    assert.deepEqual(logger.errorMessages, ["Renderer load failed"])
    assert.throws(() => requestWindowPresentation(asBrowserWindow(window)), /destroyed window/)
  })

  it("does not let an unowned navigation failure mutate the managed load", () => {
    const window = new FakeBrowserWindow()
    const logger = startLoad(window)

    window.webContents.emit("did-fail-load", {}, -105, "failure", "file://frame", false)

    assert.equal(window.destroyCount, 0)
    assert.deepEqual(logger.errorMessages, [])
  })

  it("destroys an aborted managed load", async () => {
    const window = new FakeBrowserWindow()
    let rejectLoad: (error: Error) => void = () => undefined
    window.loadFilePromise = new Promise((_, reject) => {
      rejectLoad = reject
    })
    const logger = startLoad(window)

    rejectLoad(new Error("managed load aborted"))
    await new Promise<void>((resolve) => setImmediate(resolve))

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

  it("reloads one crashed renderer without closing its window or losing its web contents owner", async () => {
    const window = new FakeBrowserWindow()
    let rejectInitialLoad: (error: Error) => void = () => undefined
    window.loadFileResults = [
      new Promise((_, reject) => {
        rejectInitialLoad = reject
      }),
      Promise.resolve()
    ]
    const graph = new FakeDiagnosticGraph()
    const logger = startLoad(window, { graph })
    const owner = window.webContents

    window.webContents.emit("render-process-gone", {}, {
      exitCode: 9,
      reason: "crashed"
    } satisfies RenderProcessGoneDetails)
    assert.equal(window.loadFileCount, 1)
    rejectInitialLoad(new Error("stale first load rejection"))
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.equal(window.destroyCount, 0)
    assert.equal(window.loadFileCount, 2)
    assert.equal(window.webContents, owner)
    assert.deepEqual(logger.errorMessages, ["Renderer process gone"])
    assert.deepEqual(
      graph.inputs.map(({ eventCode }) => eventCode),
      [
        "electron.renderer_process_gone",
        "electron.renderer_recovery_started",
        "electron.renderer_recovery_succeeded"
      ]
    )
    assert.deepEqual(graph.inputs[1].parentEvents, [
      { eventId: "event-1", sequence: 1, sessionId: "test" }
    ])
    assert.deepEqual(graph.inputs[2].parentEvents, [
      { eventId: "event-2", sequence: 2, sessionId: "test" }
    ])
    assert.deepEqual(graph.inputs[2].refs, [
      { id: String(window.id), kind: "window" },
      { id: String(window.webContents.id), kind: "web-contents" }
    ])
  })

  it("reads the latest Main binding for every recovered renderer bootstrap", async () => {
    for (const initialThreadId of ["thread-a", null] as const) {
      const window = new FakeBrowserWindow()
      window.loadFileResults = [
        Promise.resolve(),
        Promise.resolve(),
        Promise.resolve(),
        Promise.resolve()
      ]
      let currentThreadId: string | null = initialThreadId
      startLoad(window, {
        query: () => (currentThreadId ? { threadId: currentThreadId } : undefined),
        windowKind: "main"
      })
      await new Promise<void>((resolve) => setImmediate(resolve))

      currentThreadId = "thread-b"
      window.webContents.emit("render-process-gone", {}, {
        exitCode: 9,
        reason: "crashed"
      } satisfies RenderProcessGoneDetails)
      await new Promise<void>((resolve) => setImmediate(resolve))

      const bootstrapQueries = window.loadFileQueries.filter(
        (query) => query?.["window"] === "main"
      )
      assert.equal(bootstrapQueries.length, 2)
      assert.equal(bootstrapQueries[0]?.["threadId"], initialThreadId ?? undefined)
      assert.equal(bootstrapQueries[1]?.["threadId"], "thread-b")
      assert.equal(window.destroyCount, 0)
    }
  })

  it("does not let a stale Main splash load start a renderer navigation after recovery", async () => {
    const window = new FakeBrowserWindow()
    let resolveInitialSplash: () => void = () => undefined
    window.loadFileResults = [
      new Promise<void>((resolve) => {
        resolveInitialSplash = resolve
      }),
      Promise.resolve(),
      Promise.resolve()
    ]
    const logger = startLoad(window, { windowKind: "main" })

    window.webContents.emit("render-process-gone", {}, {
      exitCode: 9,
      reason: "crashed"
    } satisfies RenderProcessGoneDetails)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(window.loadFileCount, 3)

    resolveInitialSplash()
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.equal(window.loadFileCount, 3)
    assert.equal(window.destroyCount, 0)
    assert.deepEqual(logger.errorMessages, ["Renderer process gone"])
  })

  it("terminates a repeated renderer crash without entering a reload loop", async () => {
    const window = new FakeBrowserWindow()
    const order: string[] = []
    window.once("closed", () => order.push("closed"))
    const graph = new FakeDiagnosticGraph()
    const logger = startLoad(window, {
      graph,
      onTerminalFailure: () => order.push("failure")
    })

    window.webContents.emit("render-process-gone", {}, {
      exitCode: 9,
      reason: "crashed"
    } satisfies RenderProcessGoneDetails)
    assert.equal(window.loadFileCount, 1)
    window.webContents.emit("render-process-gone", {}, {
      exitCode: 9,
      reason: "crashed"
    } satisfies RenderProcessGoneDetails)
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.equal(window.loadFileCount, 1)
    assert.equal(window.destroyCount, 1)
    assert.deepEqual(order, ["failure", "closed"])
    assert.deepEqual(logger.errorMessages, [
      "Renderer process gone",
      "Renderer process gone",
      "Renderer recovery exhausted"
    ])
    assert.deepEqual(
      graph.inputs.map(({ eventCode }) => eventCode),
      [
        "electron.renderer_process_gone",
        "electron.renderer_recovery_started",
        "electron.renderer_process_gone",
        "electron.renderer_recovery_exhausted"
      ]
    )
    assert.deepEqual(graph.inputs[3].dimensionEntries, [
      { key: "attempt", value: 1 },
      { key: "terminalReason", value: "recovery-exhausted" },
      { key: "windowKind", value: "settings" }
    ])
    assert.deepEqual(graph.inputs[3].parentEvents, [
      { eventId: "event-2", sequence: 2, sessionId: "test" },
      { eventId: "event-3", sequence: 3, sessionId: "test" }
    ])
  })

  it("links a crash after successful recovery through the succeeded event", async () => {
    const window = new FakeBrowserWindow()
    window.loadFileResults = [Promise.resolve(), Promise.resolve()]
    const graph = new FakeDiagnosticGraph()
    startLoad(window, { graph })
    await new Promise<void>((resolve) => setImmediate(resolve))

    window.webContents.emit("render-process-gone", {}, {
      exitCode: 9,
      reason: "crashed"
    } satisfies RenderProcessGoneDetails)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(window.destroyCount, 0)

    window.webContents.emit("render-process-gone", {}, {
      exitCode: 9,
      reason: "crashed"
    } satisfies RenderProcessGoneDetails)

    assert.equal(window.destroyCount, 1)
    assert.deepEqual(
      graph.inputs.map(({ eventCode }) => eventCode),
      [
        "electron.renderer_process_gone",
        "electron.renderer_recovery_started",
        "electron.renderer_recovery_succeeded",
        "electron.renderer_process_gone",
        "electron.renderer_recovery_exhausted"
      ]
    )
    assert.deepEqual(graph.inputs[4].parentEvents, [
      { eventId: "event-3", sequence: 3, sessionId: "test" },
      { eventId: "event-4", sequence: 4, sessionId: "test" }
    ])
  })

  it("does not classify a clean exit after successful recovery as exhausted", async () => {
    const window = new FakeBrowserWindow()
    window.loadFileResults = [Promise.resolve(), Promise.resolve()]
    const graph = new FakeDiagnosticGraph()
    const logger = startLoad(window, { graph })
    await new Promise<void>((resolve) => setImmediate(resolve))

    window.webContents.emit("render-process-gone", {}, {
      exitCode: 9,
      reason: "crashed"
    } satisfies RenderProcessGoneDetails)
    await new Promise<void>((resolve) => setImmediate(resolve))

    window.webContents.emit("render-process-gone", {}, {
      exitCode: 0,
      reason: "clean-exit"
    } satisfies RenderProcessGoneDetails)

    assert.equal(window.destroyCount, 1)
    assert.deepEqual(logger.errorMessages, ["Renderer process gone"])
    assert.deepEqual(
      graph.inputs.map(({ eventCode }) => eventCode),
      [
        "electron.renderer_process_gone",
        "electron.renderer_recovery_started",
        "electron.renderer_recovery_succeeded"
      ]
    )
  })

  it("terminates OOM and integrity failures without attempting recovery", () => {
    for (const reason of ["integrity-failure", "oom"] as const) {
      const window = new FakeBrowserWindow()
      const logger = startLoad(window)

      window.webContents.emit("render-process-gone", {}, {
        exitCode: 9,
        reason
      } satisfies RenderProcessGoneDetails)

      assert.equal(window.loadFileCount, 1)
      assert.equal(window.destroyCount, 1)
      assert.deepEqual(logger.errorMessages, ["Renderer process gone"])
    }
  })

  it("terminates when the bounded renderer recovery load fails", async () => {
    const window = new FakeBrowserWindow()
    let rejectRecoveryLoad: (error: Error) => void = () => undefined
    window.loadFileResults = [
      new Promise(() => undefined),
      new Promise((_, reject) => {
        rejectRecoveryLoad = reject
      })
    ]
    const graph = new FakeDiagnosticGraph()
    const logger = startLoad(window, { graph })

    window.webContents.emit("render-process-gone", {}, {
      exitCode: 9,
      reason: "crashed"
    } satisfies RenderProcessGoneDetails)
    await new Promise<void>((resolve) => setImmediate(resolve))
    rejectRecoveryLoad(new Error("reload failed"))
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.equal(window.loadFileCount, 2)
    assert.equal(window.destroyCount, 1)
    assert.deepEqual(
      graph.inputs.map(({ eventCode }) => eventCode),
      [
        "electron.renderer_process_gone",
        "electron.renderer_recovery_started",
        "electron.renderer_load_failed",
        "electron.renderer_recovery_exhausted"
      ]
    )
    assert.deepEqual(graph.inputs[3].dimensionEntries, [
      { key: "attempt", value: 1 },
      { key: "terminalReason", value: "recovery-failed" },
      { key: "windowKind", value: "settings" }
    ])
    assert.deepEqual(graph.inputs[3].parentEvents, [
      { eventId: "event-2", sequence: 2, sessionId: "test" },
      { eventId: "event-3", sequence: 3, sessionId: "test" }
    ])
    assert.deepEqual(logger.errorMessages, [
      "Renderer process gone",
      "Renderer load failed",
      "Renderer recovery exhausted"
    ])
  })

  it("keeps cleanup exact-once when the diagnostics observer throws", () => {
    const window = new FakeBrowserWindow()
    const graph = new FakeDiagnosticGraph()
    const logger = new FakeDiagnosticsLogger()
    logger.error = () => {
      throw new Error("diagnostics unavailable")
    }
    startLoad(window, { graph, logger })

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
    assert.deepEqual(
      graph.inputs.map(({ eventCode }) => eventCode),
      ["electron.preload_failed"]
    )
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

  it("does not continue deferred or pending-splash recovery after shutdown begins", async () => {
    const pendingSplashWindow = new FakeBrowserWindow()
    let resolveRecoverySplash: () => void = () => undefined
    pendingSplashWindow.loadFileResults = [
      new Promise(() => undefined),
      new Promise<void>((resolve) => {
        resolveRecoverySplash = resolve
      }),
      Promise.resolve()
    ]
    const pendingSplashLogger = startLoad(pendingSplashWindow, { windowKind: "main" })
    pendingSplashWindow.webContents.emit("render-process-gone", {}, {
      exitCode: 9,
      reason: "crashed"
    } satisfies RenderProcessGoneDetails)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(pendingSplashWindow.loadFileCount, 2)

    const deferredWindow = new FakeBrowserWindow()
    const deferredLogger = startLoad(deferredWindow)
    deferredWindow.webContents.emit("render-process-gone", {}, {
      exitCode: 9,
      reason: "crashed"
    } satisfies RenderProcessGoneDetails)
    assert.equal(deferredWindow.loadFileCount, 1)

    beginRendererWindowShutdown()
    resolveRecoverySplash()
    deferredWindow.webContents.emit("preload-error", {}, "preload.js", new Error("shutdown"))
    deferredWindow.webContents.emit("render-process-gone", {}, {
      exitCode: 9,
      reason: "killed"
    } satisfies RenderProcessGoneDetails)
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.equal(pendingSplashWindow.destroyCount, 0)
    assert.equal(pendingSplashWindow.loadFileCount, 2)
    assert.deepEqual(pendingSplashLogger.errorMessages, ["Renderer process gone"])
    assert.equal(deferredWindow.destroyCount, 0)
    assert.equal(deferredWindow.loadFileCount, 1)
    assert.deepEqual(deferredLogger.errorMessages, ["Renderer process gone"])
  })
})
