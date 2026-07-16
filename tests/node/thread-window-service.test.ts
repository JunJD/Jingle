import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { describe, it } from "node:test"
import { ThreadWindowService, resolveThreadWindowResourceLimit } from "../../src/main/thread-window/service"

class FakeWindow extends EventEmitter {
  sent: unknown[] = []
  webContents = { isDestroyed: () => false, send: (_channel: string, value: unknown) => this.sent.push(value) }
  getNormalBounds() { return { x: 10, y: 10, width: 1000, height: 700 } }
  isDestroyed() { return false }
  isMaximized() { return false }
}

function createService(limit = 8) {
  const windows: FakeWindow[] = []
  const refusals: unknown[] = []
  let restoreState = { version: 1 as const, windows: [] as Array<{ bounds?: { x: number; y: number; width: number; height: number }; isMaximized: boolean; threadId: string | null; windowId: string }> }
  const service = new ThreadWindowService({
    createThreadWindow: () => { const window = new FakeWindow(); windows.push(window); return window as never },
    getRestoreState: () => restoreState,
    onWindowClosed: () => {},
    onWindowOpened: () => {},
    recordResourceRefusal: (details) => refusals.push(details),
    setRestoreState: (state) => (restoreState = state),
    setWindowThread: () => {}
  }, limit)
  return { refusals, restore: () => restoreState, service, windows }
}

describe("ThreadWindowService", () => {
  it("allows duplicate windows for one thread and persists each identity", () => {
    const { restore, service, windows } = createService()
    assert.equal(service.openNew({ threadId: "thread-a" }).ok, true)
    assert.equal(service.openNew({ threadId: "thread-a" }).ok, true)
    assert.equal(windows.length, 2)
    assert.deepEqual(restore().windows.map((entry) => entry.threadId), ["thread-a", "thread-a"])
  })

  it("reports a resource refusal instead of enforcing a product window count", () => {
    const { refusals, service } = createService(1)
    assert.equal(service.openNew().ok, true)
    assert.deepEqual(service.openNew(), { current: 1, limit: 1, ok: false, reason: "resource_limit" })
    assert.deepEqual(refusals, [{ current: 1, limit: 1 }])
  })
})

it("derives the safety limit from available memory within observable bounds", () => {
  assert.equal(resolveThreadWindowResourceLimit(512 * 1024 * 1024), 8)
  assert.equal(resolveThreadWindowResourceLimit(128 * 1024 * 1024 * 1024), 64)
})
