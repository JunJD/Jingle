import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"
import { bindLauncherSearchSenderLifetime } from "../../src/main/launcher/search-sender-lifetime"

class FakeLauncherSearchSender extends EventEmitter {
  readonly id = 42
  destroyed = false

  isDestroyed(): boolean {
    return this.destroyed
  }
}

test("launcher search sender destruction cancels only its scoped caller lease", () => {
  const sender = new FakeLauncherSearchSender()
  const cancelled: string[] = []
  const lifetime = bindLauncherSearchSenderLifetime({
    callerId: "request-1",
    cancel: (callerId) => cancelled.push(callerId),
    sender
  })
  lifetime.activate()

  sender.destroyed = true
  sender.emit("destroyed")
  assert.deepEqual(cancelled, ["42:request-1"])

  lifetime.dispose()
  sender.emit("destroyed")
  assert.deepEqual(cancelled, ["42:request-1"])
})

test("launcher search rejects invalid caller ids before installing a sender listener", () => {
  const sender = new FakeLauncherSearchSender()

  assert.throws(
    () =>
      bindLauncherSearchSenderLifetime({
        callerId: "",
        cancel: () => undefined,
        sender
      }),
    /caller id is invalid/
  )
  assert.equal(sender.listenerCount("destroyed"), 0)
})

test("already destroyed launcher sender is cancelled during lifetime binding", () => {
  const sender = new FakeLauncherSearchSender()
  sender.destroyed = true
  const cancelled: string[] = []
  const lifetime = bindLauncherSearchSenderLifetime({
    callerId: "request-2",
    cancel: (callerId) => cancelled.push(callerId),
    sender
  })

  assert.deepEqual(cancelled, [])
  lifetime.activate()
  assert.deepEqual(cancelled, ["42:request-2"])
  lifetime.dispose()
})
