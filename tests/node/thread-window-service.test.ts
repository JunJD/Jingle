import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { describe, it } from "node:test"
import {
  ThreadWindowService,
  resolveThreadWindowResourceLimit
} from "../../src/main/thread-window/service"
import type { ThreadWindowRestoreState } from "../../src/main/preferences"
import { DurableWindowRestorePolicy } from "../../src/main/durable-window/restore-policy"
import {
  getDurableWindowCallerLease,
  getWindowIdentity,
  registerDurableWindowIdentity,
  setDurableWindowIdentityThread
} from "../../src/main/windows/window-identity"

class FakeWindow extends EventEmitter {
  destroyed = false
  webContentsDestroyed = false
  sent: unknown[] = []
  webContents = {
    isDestroyed: () => this.destroyed || this.webContentsDestroyed,
    send: (_channel: string, value: unknown) => this.sent.push(value)
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    const emitWebContents = (this.webContents as { emit?: (event: string) => void }).emit
    emitWebContents?.call(this.webContents, "destroyed")
    this.emit("closed")
  }
  getNormalBounds() {
    return { x: 10, y: 10, width: 1000, height: 700 }
  }
  isDestroyed() {
    return this.destroyed
  }
  isMaximized() {
    return false
  }
}

function createService(
  limit = 8,
  getThread: (threadId: string) => Promise<{ archivedAt: number | null } | null> = async () => ({
    archivedAt: null
  })
) {
  const events: string[] = []
  const windows: FakeWindow[] = []
  const refusals: unknown[] = []
  const restoreFailures: Array<{ error: unknown; windowId: string | null }> = []
  const restoreRepairs: unknown[] = []
  const activations: boolean[] = []
  const rendererFailureCallbacks: Array<() => void> = []
  const windowBindings = new WeakMap<FakeWindow, { threadId: string | null; windowId: string }>()
  let persistenceError: Error | null = null
  let restoreState = {
    version: 1 as const,
    windows: [] as Array<{
      bounds?: { x: number; y: number; width: number; height: number }
      isMaximized: boolean
      threadId: string | null
      windowId: string
    }>
  }
  const service = new ThreadWindowService(
    {
      createThreadWindow: (_entry, options) => {
        events.push(`create:${_entry.windowId}`)
        const window = new FakeWindow()
        activations.push(options.activate)
        rendererFailureCallbacks.push(options.onRendererFailure)
        windowBindings.set(window, { threadId: _entry.threadId, windowId: _entry.windowId })
        windows.push(window)
        return window as never
      },
      getRestoreState: () => restoreState,
      getWindowBinding: (window) => {
        const binding = windowBindings.get(window as unknown as FakeWindow)
        return binding ? { kind: "thread-window", ...binding } : { kind: "replaced" }
      },
      onWindowClosed: () => {},
      onWindowOpened: () => {},
      recordResourceRefusal: (details) => refusals.push(details),
      recordRestoreFailure: (details) => restoreFailures.push(details),
      recordRestoreRepair: (details) => restoreRepairs.push(details),
      setRestoreState: (state) => {
        events.push(`persist:${state.windows.map(({ windowId }) => windowId).join(",")}`)
        if (persistenceError) throw persistenceError
        return (restoreState = state)
      },
      setWindowThread: (window, threadId) => {
        const fakeWindow = window as unknown as FakeWindow
        const binding = windowBindings.get(fakeWindow)
        if (!binding) throw new Error("Thread window binding is unavailable.")
        windowBindings.set(fakeWindow, { ...binding, threadId })
      }
    },
    new DurableWindowRestorePolicy({ getThread }),
    limit
  )
  return {
    activations,
    events,
    refusals,
    getWindowThreadId: (window: FakeWindow) => windowBindings.get(window)?.threadId,
    rendererFailureCallbacks,
    restore: () => restoreState,
    restoreFailures,
    restoreRepairs,
    service,
    setPersistenceError: (error: Error | null) => {
      persistenceError = error
    },
    setRestore: (state: typeof restoreState) => {
      restoreState = state
    },
    windows
  }
}

describe("ThreadWindowService", () => {
  it("rejects a sender whose WebContents was destroyed before its window close event", () => {
    const { service, windows } = createService()
    assert.equal(service.openNew({ threadId: "thread-a" }).ok, true)
    const window = windows[0]!
    window.webContentsDestroyed = true

    assert.throws(
      () => service.getSenderThreadBinding(window.webContents as never),
      /registered window sender/
    )
    assert.throws(
      () => service.bindSenderThread(window.webContents as never, "thread-b"),
      /registered window sender/
    )
    assert.equal(service.isSender(window.webContents as never), false)
  })

  it("allows duplicate windows for one thread and persists each identity", () => {
    const { activations, restore, service, windows } = createService()
    assert.equal(service.openNew({ threadId: "thread-a" }).ok, true)
    assert.equal(service.openNew({ threadId: "thread-a" }).ok, true)
    assert.equal(windows.length, 2)
    assert.deepEqual(activations, [true, true])
    assert.deepEqual(
      restore().windows.map((entry) => entry.threadId),
      ["thread-a", "thread-a"]
    )
  })

  it("serves the latest revisioned binding after a renderer reload", () => {
    const { service, windows } = createService()
    assert.equal(service.openNew({ threadId: "thread-a" }).ok, true)
    const sender = windows[0]!.webContents as never

    assert.deepEqual(service.getSenderThreadBinding(sender), {
      revision: 1,
      threadId: "thread-a"
    })
    assert.deepEqual(service.bindSenderThread(sender, "thread-b"), {
      revision: 2,
      threadId: "thread-b"
    })
    assert.deepEqual(service.getSenderThreadBinding(sender), {
      revision: 2,
      threadId: "thread-b"
    })
  })

  it("publishes the authoritative revision when persistence rejects a rebind", () => {
    const { restore, service, setPersistenceError, windows } = createService()
    assert.equal(service.openNew({ threadId: "thread-a" }).ok, true)
    setPersistenceError(new Error("storage unavailable"))

    assert.throws(
      () => service.bindSenderThread(windows[0]!.webContents as never, "thread-b"),
      /committed but could not be persisted/
    )
    assert.deepEqual(service.getSenderThreadBinding(windows[0]!.webContents as never), {
      revision: 2,
      threadId: "thread-b"
    })
    assert.deepEqual(windows[0]!.sent, [{ revision: 2, threadId: "thread-b" }])

    setPersistenceError(null)
    assert.deepEqual(service.bindSenderThread(windows[0]!.webContents as never, "thread-b"), {
      revision: 2,
      threadId: "thread-b"
    })
    assert.deepEqual(service.getSenderThreadBinding(windows[0]!.webContents as never), {
      revision: 2,
      threadId: "thread-b"
    })
    assert.deepEqual(windows[0]!.sent, [
      { revision: 2, threadId: "thread-b" },
      { revision: 2, threadId: "thread-b" }
    ])
    assert.equal(restore().windows[0]?.threadId, "thread-b")
  })

  it("reports a resource refusal instead of enforcing a product window count", () => {
    const { refusals, service } = createService(1)
    assert.equal(service.openNew().ok, true)
    assert.deepEqual(service.openNew(), {
      current: 1,
      limit: 1,
      ok: false,
      reason: "resource_limit"
    })
    assert.deepEqual(refusals, [{ current: 1, limit: 1 }])
  })

  it("restores windows without activation and repairs duplicate identities", async () => {
    const { activations, restore, restoreFailures, service, setRestore, windows } = createService()
    setRestore({
      version: 1,
      windows: [
        { isMaximized: false, threadId: "thread-a", windowId: "window-a" },
        { isMaximized: false, threadId: "thread-copy", windowId: "window-a" },
        { isMaximized: false, threadId: "thread-b", windowId: "window-b" }
      ]
    })

    const restoring = service.restore()
    assert.equal(windows.length, 0)
    await restoring

    assert.equal(windows.length, 3)
    assert.deepEqual(activations, [false, false, false])
    const restoredIds = restore().windows.map(({ windowId }) => windowId)
    assert.equal(new Set(restoredIds).size, 3)
    assert.equal(restoredIds.includes("window-a"), true)
    assert.equal(restoredIds.includes("window-b"), true)
    assert.deepEqual(
      restoreFailures.map(({ windowId }) => windowId),
      ["window-a"]
    )
  })

  it("keeps restoring after one window creation fails", async () => {
    const windows: FakeWindow[] = []
    const failures: Array<{ error: unknown; windowId: string | null }> = []
    let restoreState: ThreadWindowRestoreState = {
      version: 1,
      windows: ["window-a", "window-b", "window-c"].map((windowId) => ({
        isMaximized: false,
        threadId: null,
        windowId
      }))
    }
    const service = new ThreadWindowService(
      {
        createThreadWindow: (entry) => {
          if (entry.windowId === "window-b") throw new Error("restore failed")
          const window = new FakeWindow()
          windows.push(window)
          return window as never
        },
        getRestoreState: () => restoreState,
        getWindowBinding: () => ({
          kind: "thread-window",
          threadId: null,
          windowId: "unused"
        }),
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordResourceRefusal: () => {},
        recordRestoreFailure: (details) => failures.push(details),
        recordRestoreRepair: () => {},
        setRestoreState: (state) => (restoreState = state),
        setWindowThread: () => {}
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) })
    )

    await service.restore()

    assert.equal(windows.length, 2)
    assert.deepEqual(
      new Set(restoreState.windows.map(({ windowId }) => windowId)),
      new Set(["window-a", "window-b", "window-c"])
    )
    assert.deepEqual(
      failures.map(({ windowId }) => windowId),
      ["window-b"]
    )
  })

  it("keeps resource-deferred windows in the durable restore state", async () => {
    const { refusals, restore, service, setRestore, windows } = createService(1)
    setRestore({
      version: 1,
      windows: [
        { isMaximized: false, threadId: "thread-a", windowId: "window-a" },
        { isMaximized: false, threadId: "thread-b", windowId: "window-b" }
      ]
    })

    await service.restore()

    assert.equal(windows.length, 1)
    assert.deepEqual(
      restore().windows.map(({ windowId }) => windowId),
      ["window-a", "window-b"]
    )
    assert.deepEqual(refusals, [{ current: 2, limit: 1 }])
  })

  it("repairs stale bindings before resource accounting and window creation", async () => {
    const { events, refusals, restore, restoreRepairs, service, setRestore, windows } =
      createService(2, async (threadId) => {
        if (threadId === "thread-active") return { archivedAt: null }
        if (threadId === "thread-archived") return { archivedAt: 1 }
        return null
      })
    setRestore({
      version: 1,
      windows: [
        { isMaximized: false, threadId: "thread-active", windowId: "window-active" },
        { isMaximized: false, threadId: "thread-archived", windowId: "window-archived" },
        { isMaximized: false, threadId: "thread-missing", windowId: "window-missing" },
        { isMaximized: false, threadId: null, windowId: "window-unbound" }
      ]
    })

    await service.restore()

    assert.equal(windows.length, 2)
    assert.deepEqual(refusals, [])
    assert.deepEqual(
      restore()
        .windows.map(({ windowId }) => windowId)
        .sort(),
      ["window-active", "window-unbound"]
    )
    assert.deepEqual(restoreRepairs, [
      {
        archivedBindingCount: 1,
        missingBindingCount: 1,
        sampleBindings: [
          {
            reason: "archived",
            threadId: "thread-archived",
            windowId: "window-archived"
          },
          {
            reason: "missing",
            threadId: "thread-missing",
            windowId: "window-missing"
          }
        ],
        surface: "thread-window"
      }
    ])
    const staleRepairIndex = events.indexOf("persist:window-active,window-unbound")
    const firstCreateIndex = events.findIndex((event) => event.startsWith("create:"))
    assert.ok(staleRepairIndex >= 0)
    assert.ok(firstCreateIndex > staleRepairIndex)
  })

  it("retains the latest persisted state for a failed restored window", async () => {
    const { rendererFailureCallbacks, restore, service, setRestore, windows } = createService()
    setRestore({
      version: 1,
      windows: [
        { isMaximized: false, threadId: "thread-a", windowId: "window-a" },
        { isMaximized: false, threadId: "thread-b", windowId: "window-b" }
      ]
    })
    await service.restore()

    windows[0].emit("ready-to-show")
    service.bindSenderThread(windows[0].webContents as never, "thread-rebound")
    rendererFailureCallbacks[0]()
    windows[0].emit("closed")
    windows[1].emit("ready-to-show")
    windows[1].emit("closed")
    service.markApplicationQuitting()

    assert.deepEqual(restore().windows, [
      {
        bounds: { x: 10, y: 10, width: 1000, height: 700 },
        isMaximized: false,
        threadId: "thread-rebound",
        windowId: "window-a"
      }
    ])
  })

  it("adopts and publishes a nested authoritative binding after the requested rebind loses", () => {
    const window = new FakeWindow()
    const webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => window.isDestroyed(),
      send: (_channel: string, value: unknown) => window.sent.push(value)
    })
    ;(window as unknown as { webContents: typeof webContents }).webContents = webContents
    let restoreState: ThreadWindowRestoreState = { version: 1, windows: [] }
    const service = new ThreadWindowService(
      {
        createThreadWindow: (entry) => {
          registerDurableWindowIdentity(webContents as never, {
            kind: "thread-window",
            threadId: entry.threadId,
            windowId: entry.windowId
          })
          return window as never
        },
        getRestoreState: () => restoreState,
        getWindowBinding: () => {
          const identity = getWindowIdentity(webContents as never)
          return identity?.kind === "thread-window"
            ? {
                kind: "thread-window",
                threadId: identity.threadId,
                windowId: identity.windowId
              }
            : { kind: "replaced" }
        },
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordResourceRefusal: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        setRestoreState: (state) => (restoreState = state),
        setWindowThread: (_window, threadId) =>
          setDurableWindowIdentityThread(webContents as never, threadId)
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) })
    )

    const opened = service.openNew({ threadId: "thread-a" })
    assert.equal(opened.ok, true)
    const originalLease = getDurableWindowCallerLease(webContents as never)
    assert.ok(originalLease)
    originalLease.signal.addEventListener(
      "abort",
      () => setDurableWindowIdentityThread(webContents as never, "thread-c"),
      { once: true }
    )

    assert.throws(
      () => service.bindSenderThread(webContents as never, "thread-b"),
      /changed during revocation/
    )
    assert.equal(restoreState.windows[0]?.threadId, "thread-c")
    assert.deepEqual(window.sent, [{ revision: 2, threadId: "thread-c" }])
    assert.equal(getDurableWindowCallerLease(webContents as never)?.threadId, "thread-c")
  })

  it("keeps the previous binding when identity mutation fails before changing it", () => {
    const window = new FakeWindow()
    let restoreState: ThreadWindowRestoreState = { version: 1, windows: [] }
    let authoritativeThreadId: string | null = null
    let windowId = ""
    const service = new ThreadWindowService(
      {
        createThreadWindow: (entry) => {
          authoritativeThreadId = entry.threadId
          windowId = entry.windowId
          return window as never
        },
        getRestoreState: () => restoreState,
        getWindowBinding: () => ({
          kind: "thread-window",
          threadId: authoritativeThreadId,
          windowId
        }),
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordResourceRefusal: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        setRestoreState: (state) => (restoreState = state),
        setWindowThread: () => {
          throw new Error("identity write failed")
        }
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) })
    )

    service.openNew({ threadId: "thread-a" })
    assert.throws(
      () => service.bindSenderThread(window.webContents as never, "thread-b"),
      /identity write failed/
    )
    assert.equal(restoreState.windows[0]?.threadId, "thread-a")
    assert.deepEqual(window.sent, [])
  })

  it("destroys a window when a nested rebind leaves its authoritative thread unbound", () => {
    const window = new FakeWindow()
    const webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => window.isDestroyed(),
      send: (_channel: string, value: unknown) => window.sent.push(value)
    })
    ;(window as unknown as { webContents: typeof webContents }).webContents = webContents
    let restoreState: ThreadWindowRestoreState = { version: 1, windows: [] }
    const service = new ThreadWindowService(
      {
        createThreadWindow: (entry) => {
          registerDurableWindowIdentity(webContents as never, {
            kind: "thread-window",
            threadId: entry.threadId,
            windowId: entry.windowId
          })
          return window as never
        },
        getRestoreState: () => restoreState,
        getWindowBinding: () => {
          const identity = getWindowIdentity(webContents as never)
          return identity?.kind === "thread-window"
            ? {
                kind: "thread-window",
                threadId: identity.threadId,
                windowId: identity.windowId
              }
            : { kind: "replaced" }
        },
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordResourceRefusal: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        setRestoreState: (state) => (restoreState = state),
        setWindowThread: (_window, threadId) =>
          setDurableWindowIdentityThread(webContents as never, threadId)
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) })
    )

    service.openNew({ threadId: "thread-a" })
    const originalLease = getDurableWindowCallerLease(webContents as never)
    assert.ok(originalLease)
    originalLease.signal.addEventListener(
      "abort",
      () => setDurableWindowIdentityThread(webContents as never, null),
      { once: true }
    )

    assert.throws(
      () => service.bindSenderThread(webContents as never, "thread-b"),
      /changed during revocation/
    )
    assert.equal(window.isDestroyed(), true)
    assert.equal(getDurableWindowCallerLease(webContents as never), null)
    assert.deepEqual(window.sent, [])
    service.markApplicationQuitting()
    assert.deepEqual(restoreState.windows, [])
  })

  it("destroys a window whose durable identity is replaced during rebind", () => {
    const window = new FakeWindow()
    let restoreState: ThreadWindowRestoreState = { version: 1, windows: [] }
    let replaced = false
    let windowId = ""
    const service = new ThreadWindowService(
      {
        createThreadWindow: (entry) => {
          windowId = entry.windowId
          return window as never
        },
        getRestoreState: () => restoreState,
        getWindowBinding: () =>
          replaced
            ? { kind: "replaced" }
            : { kind: "thread-window", threadId: "thread-a", windowId },
        onWindowClosed: () => {},
        onWindowOpened: () => {},
        recordResourceRefusal: () => {},
        recordRestoreFailure: () => {},
        recordRestoreRepair: () => {},
        setRestoreState: (state) => (restoreState = state),
        setWindowThread: () => {
          replaced = true
          throw new Error("identity replaced")
        }
      },
      new DurableWindowRestorePolicy({ getThread: async () => ({ archivedAt: null }) })
    )

    service.openNew({ threadId: "thread-a" })
    assert.throws(
      () => service.bindSenderThread(window.webContents as never, "thread-b"),
      /identity replaced/
    )
    assert.equal(window.isDestroyed(), true)
    service.markApplicationQuitting()
    assert.deepEqual(restoreState.windows, [])
  })

  it("rechecks the resource limit after a concurrent window pin", async () => {
    const { activations, restore, service, setRestore, windows } = createService(1)
    setRestore({
      version: 1,
      windows: [{ isMaximized: false, threadId: "thread-a", windowId: "window-a" }]
    })

    const restoring = service.restore()
    assert.equal(service.openNew({ threadId: "thread-new" }).ok, true)
    await restoring

    assert.equal(windows.length, 1)
    assert.deepEqual(activations, [true])
    assert.equal(
      restore().windows.some(({ windowId }) => windowId === "window-a"),
      true
    )
  })

  it("stops creating restored windows after application quit begins", async () => {
    const { restore, service, setRestore, windows } = createService()
    setRestore({
      version: 1,
      windows: [{ isMaximized: false, threadId: "thread-a", windowId: "window-a" }]
    })

    const restoring = service.restore()
    service.markApplicationQuitting()
    await restoring

    assert.equal(windows.length, 0)
    assert.deepEqual(
      restore().windows.map(({ windowId }) => windowId),
      ["window-a"]
    )
  })

  it("rejects new windows and thread rebinding after application quit begins", () => {
    const { getWindowThreadId, restore, service, windows } = createService()
    assert.equal(service.openNew({ threadId: "thread-a" }).ok, true)
    service.markApplicationQuitting()
    const stateAtQuit = restore()

    assert.throws(
      () => service.openNew({ threadId: "thread-new" }),
      /after application quit begins/
    )
    assert.throws(
      () => service.bindSenderThread(windows[0]!.webContents as never, "thread-rebound"),
      /after application quit begins/
    )
    assert.equal(windows.length, 1)
    assert.equal(getWindowThreadId(windows[0]!), "thread-a")
    assert.equal(restore(), stateAtQuit)
    assert.equal(restore().windows[0]?.threadId, "thread-a")
  })
})

it("derives the safety limit from available memory within observable bounds", () => {
  assert.equal(resolveThreadWindowResourceLimit(512 * 1024 * 1024), 8)
  assert.equal(resolveThreadWindowResourceLimit(128 * 1024 * 1024 * 1024), 64)
})
