import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { describe, it } from "node:test"
import {
  ThreadWindowService,
  resolveThreadWindowResourceLimit
} from "../../src/main/thread-window/service"
import type { ThreadWindowRestoreState } from "../../src/main/preferences"

class FakeWindow extends EventEmitter {
  sent: unknown[] = []
  webContents = {
    isDestroyed: () => false,
    send: (_channel: string, value: unknown) => this.sent.push(value)
  }
  getNormalBounds() {
    return { x: 10, y: 10, width: 1000, height: 700 }
  }
  isDestroyed() {
    return false
  }
  isMaximized() {
    return false
  }
}

function createService(limit = 8) {
  const windows: FakeWindow[] = []
  const refusals: unknown[] = []
  const restoreFailures: Array<{ error: unknown; windowId: string | null }> = []
  const activations: boolean[] = []
  const rendererFailureCallbacks: Array<() => void> = []
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
        const window = new FakeWindow()
        activations.push(options.activate)
        rendererFailureCallbacks.push(options.onRendererFailure)
        windows.push(window)
        return window as never
      },
      getRestoreState: () => restoreState,
      onWindowClosed: () => {},
      onWindowOpened: () => {},
      recordResourceRefusal: (details) => refusals.push(details),
      recordRestoreFailure: (details) => restoreFailures.push(details),
      setRestoreState: (state) => (restoreState = state),
      setWindowThread: () => {}
    },
    limit
  )
  return {
    activations,
    refusals,
    rendererFailureCallbacks,
    restore: () => restoreState,
    restoreFailures,
    service,
    setRestore: (state: typeof restoreState) => {
      restoreState = state
    },
    windows
  }
}

describe("ThreadWindowService", () => {
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
    const service = new ThreadWindowService({
      createThreadWindow: (entry) => {
        if (entry.windowId === "window-b") throw new Error("restore failed")
        const window = new FakeWindow()
        windows.push(window)
        return window as never
      },
      getRestoreState: () => restoreState,
      onWindowClosed: () => {},
      onWindowOpened: () => {},
      recordResourceRefusal: () => {},
      recordRestoreFailure: (details) => failures.push(details),
      setRestoreState: (state) => (restoreState = state),
      setWindowThread: () => {}
    })

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

  it("retains a failed restored window but forgets a user-closed ready window", async () => {
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
    rendererFailureCallbacks[0]()
    windows[0].emit("closed")
    windows[1].emit("ready-to-show")
    windows[1].emit("closed")
    service.markApplicationQuitting()

    assert.deepEqual(
      restore().windows.map(({ windowId }) => windowId),
      ["window-a"]
    )
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
})

it("derives the safety limit from available memory within observable bounds", () => {
  assert.equal(resolveThreadWindowResourceLimit(512 * 1024 * 1024), 8)
  assert.equal(resolveThreadWindowResourceLimit(128 * 1024 * 1024 * 1024), 64)
})
