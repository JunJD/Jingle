import assert from "node:assert/strict"
import test from "node:test"
import { DurableWindowLifecycleService } from "../../src/main/durable-window/lifecycle"

function createLifecycle(platform: NodeJS.Platform = "win32") {
  let quitCount = 0
  const lifecycle = new DurableWindowLifecycleService(() => {
    quitCount += 1
  }, platform)

  return {
    getQuitCount: () => quitCount,
    lifecycle
  }
}

test("non-macOS exits when the last durable window closes without a supporting window", () => {
  const { getQuitCount, lifecycle } = createLifecycle()

  lifecycle.windowOpened()
  lifecycle.windowOpened()
  lifecycle.windowClosed()
  assert.equal(getQuitCount(), 0)

  lifecycle.windowClosed()
  lifecycle.windowClosed()
  assert.equal(getQuitCount(), 1)
})

test("a visible supporting window defers exit until it closes", () => {
  const { getQuitCount, lifecycle } = createLifecycle("linux")
  const launcherWindow = {}

  lifecycle.windowOpened()
  lifecycle.supportingWindowOpened(launcherWindow)
  lifecycle.windowClosed()
  assert.equal(getQuitCount(), 0)

  lifecycle.supportingWindowClosed(launcherWindow)
  assert.equal(getQuitCount(), 1)
})

test("exit remains deferred until every supporting window closes", () => {
  const { getQuitCount, lifecycle } = createLifecycle()
  const launcherWindow = {}
  const settingsWindow = {}

  lifecycle.windowOpened()
  lifecycle.supportingWindowOpened(launcherWindow)
  lifecycle.supportingWindowOpened(settingsWindow)
  lifecycle.supportingWindowOpened(settingsWindow)
  lifecycle.windowClosed()

  lifecycle.supportingWindowClosed(launcherWindow)
  assert.equal(getQuitCount(), 0)

  lifecycle.supportingWindowClosed(settingsWindow)
  lifecycle.supportingWindowClosed(settingsWindow)
  assert.equal(getQuitCount(), 1)
})

test("opening another durable window cancels a deferred exit", () => {
  const { getQuitCount, lifecycle } = createLifecycle()
  const settingsWindow = {}

  lifecycle.windowOpened()
  lifecycle.supportingWindowOpened(settingsWindow)
  lifecycle.windowClosed()
  lifecycle.windowOpened()
  lifecycle.supportingWindowClosed(settingsWindow)
  assert.equal(getQuitCount(), 0)

  lifecycle.windowClosed()
  assert.equal(getQuitCount(), 1)
})

test("supporting window changes before any durable close do not trigger exit", () => {
  const { getQuitCount, lifecycle } = createLifecycle()
  const launcherWindow = {}

  lifecycle.supportingWindowOpened(launcherWindow)
  lifecycle.supportingWindowClosed(launcherWindow)

  assert.equal(getQuitCount(), 0)
})

test("macOS remains resident after every window closes", () => {
  const { getQuitCount, lifecycle } = createLifecycle("darwin")
  const settingsWindow = {}

  lifecycle.windowOpened()
  lifecycle.supportingWindowOpened(settingsWindow)
  lifecycle.windowClosed()
  lifecycle.supportingWindowClosed(settingsWindow)

  assert.equal(getQuitCount(), 0)
})
