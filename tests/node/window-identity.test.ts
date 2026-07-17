import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import type { WebContents } from "electron"
import {
  getDurableWindowCallerLease,
  getWindowIdentity,
  registerDurableWindowIdentity,
  registerWindowIdentity,
  setDurableWindowIdentityThread
} from "../../src/main/windows/window-identity"

class FakeWebContents extends EventEmitter {
  private destroyed = false

  destroy(): void {
    this.destroyed = true
    this.emit("destroyed")
  }

  isDestroyed(): boolean {
    return this.destroyed
  }
}

function asWebContents(value: FakeWebContents): WebContents {
  return value as unknown as WebContents
}

test("durable window caller lease keeps persisted identity separate from its live binding", () => {
  const sender = new FakeWebContents()
  const webContents = asWebContents(sender)
  const first = registerDurableWindowIdentity(webContents, {
    kind: "main",
    threadId: "thread-a",
    windowId: "primary-main"
  })

  assert.deepEqual(first.window, { kind: "main", windowId: "primary-main" })
  assert.equal(first.threadId, "thread-a")
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first.window), true)
  assert.equal("pid" in first.window, false)
  assert.equal("nativeId" in first.window, false)
  assert.equal("generation" in first.window, false)
  assert.equal(first.signal.aborted, false)
  assert.equal(getDurableWindowCallerLease(webContents), first)

  setDurableWindowIdentityThread(webContents, "thread-a")
  assert.equal(getDurableWindowCallerLease(webContents), first)

  setDurableWindowIdentityThread(webContents, "thread-b")
  const second = getDurableWindowCallerLease(webContents)
  assert.ok(second)
  assert.equal(first.signal.aborted, true)
  assert.equal(second.signal.aborted, false)
  assert.equal(second.incarnation > first.incarnation, true)
  assert.deepEqual(second.window, first.window)
  assert.equal(second.threadId, "thread-b")
})

test("durable window caller lease is revoked by identity replacement and destruction", () => {
  const sender = new FakeWebContents()
  const webContents = asWebContents(sender)
  const first = registerDurableWindowIdentity(webContents, {
    kind: "thread-window",
    threadId: "thread-a",
    windowId: "window-a"
  })
  const second = registerDurableWindowIdentity(webContents, {
    kind: "thread-window",
    threadId: "thread-b",
    windowId: "window-b"
  })

  assert.equal(first.signal.aborted, true)
  assert.equal(second.signal.aborted, false)
  assert.equal(second.incarnation > first.incarnation, true)
  assert.deepEqual(second.window, { kind: "thread-window", windowId: "window-b" })

  sender.destroy()
  assert.equal(second.signal.aborted, true)
  assert.equal(getDurableWindowCallerLease(webContents), null)
})

test("generic or destroyed senders cannot retain a durable caller lease", () => {
  const sender = new FakeWebContents()
  const webContents = asWebContents(sender)
  const lease = registerDurableWindowIdentity(webContents, {
    kind: "main",
    threadId: null,
    windowId: "primary-main"
  })

  registerWindowIdentity(webContents, { kind: "settings" })
  assert.equal(lease.signal.aborted, true)
  assert.equal(getDurableWindowCallerLease(webContents), null)

  const destroyed = new FakeWebContents()
  destroyed.destroy()
  assert.throws(
    () =>
      registerDurableWindowIdentity(asWebContents(destroyed), {
        kind: "main",
        threadId: null,
        windowId: "primary-main"
      }),
    /destroyed durable window/
  )
})

test("durable window rebind is linearizable when abort listeners register another caller", () => {
  const sender = new FakeWebContents()
  const webContents = asWebContents(sender)
  const first = registerDurableWindowIdentity(webContents, {
    kind: "main",
    threadId: "thread-a",
    windowId: "primary-main"
  })
  let nested: ReturnType<typeof registerDurableWindowIdentity> | undefined
  first.signal.addEventListener("abort", () => {
    nested = registerDurableWindowIdentity(webContents, {
      kind: "thread-window",
      threadId: "thread-nested",
      windowId: "window-nested"
    })
  })

  assert.throws(
    () => setDurableWindowIdentityThread(webContents, "thread-outer"),
    /changed during revocation/
  )
  assert.ok(nested)
  assert.equal(first.signal.aborted, true)
  assert.equal(nested.signal.aborted, false)
  assert.equal(getDurableWindowCallerLease(webContents), nested)
  assert.equal(sender.listenerCount("destroyed"), 1)

  sender.destroy()
  assert.equal(nested.signal.aborted, true)
  assert.equal(getDurableWindowCallerLease(webContents), null)
})

test("nested thread rebind supersedes the caller that synchronously revoked it", () => {
  const sender = new FakeWebContents()
  const webContents = asWebContents(sender)
  const first = registerDurableWindowIdentity(webContents, {
    kind: "main",
    threadId: "thread-a",
    windowId: "primary-main"
  })
  first.signal.addEventListener("abort", () => {
    setDurableWindowIdentityThread(webContents, "thread-nested")
  })

  assert.throws(
    () => setDurableWindowIdentityThread(webContents, "thread-outer"),
    /changed during revocation/
  )
  const nested = getDurableWindowCallerLease(webContents)
  assert.ok(nested)
  assert.equal(first.signal.aborted, true)
  assert.equal(nested.signal.aborted, false)
  assert.equal(nested.threadId, "thread-nested")
  const identity = getWindowIdentity(webContents)
  assert.ok(identity?.kind === "main" || identity?.kind === "thread-window")
  assert.equal(identity.threadId, "thread-nested")
  assert.equal(sender.listenerCount("destroyed"), 1)

  sender.destroy()
  assert.equal(nested.signal.aborted, true)
  assert.equal(getDurableWindowCallerLease(webContents), null)
})
