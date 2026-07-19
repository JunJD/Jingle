import assert from "node:assert/strict"
import test from "node:test"
import { DurableWindowLifecycleService } from "../../src/main/durable-window/lifecycle"

test("durable window lifecycle keeps Windows resident after the last window closes", () => {
  let quitCount = 0
  const lifecycle = new DurableWindowLifecycleService(() => {
    quitCount += 1
  }, "win32")

  lifecycle.windowOpened()
  lifecycle.windowClosed()

  assert.equal(lifecycle.getOpenWindowCount(), 0)
  assert.equal(quitCount, 0)
})

test("durable window lifecycle preserves Linux last-window exit", () => {
  let quitCount = 0
  const lifecycle = new DurableWindowLifecycleService(() => {
    quitCount += 1
  }, "linux")

  lifecycle.windowOpened()
  lifecycle.windowClosed()

  assert.equal(lifecycle.getOpenWindowCount(), 0)
  assert.equal(quitCount, 1)
})

test("durable window lifecycle keeps macOS resident after the last window closes", () => {
  let quitCount = 0
  const lifecycle = new DurableWindowLifecycleService(() => {
    quitCount += 1
  }, "darwin")

  lifecycle.windowOpened()
  lifecycle.windowClosed()

  assert.equal(lifecycle.getOpenWindowCount(), 0)
  assert.equal(quitCount, 0)
})
