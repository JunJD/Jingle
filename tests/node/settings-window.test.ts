import { EventEmitter } from "node:events"
import assert from "node:assert/strict"
import test from "node:test"
import type { BrowserWindow } from "electron"
import { showSettingsWindow } from "../../src/main/windows/settings-window"
import { installWindowPresentation } from "../../src/main/windows/window-presentation"
import type { SettingsWindowNavigationDelivery } from "../../src/shared/settings-window"

class FakeWebContents {
  sendCalls: unknown[][] = []

  send(...args: unknown[]): void {
    this.sendCalls.push(args)
    throw new Error("renderer was replaced during reload")
  }
}

class FakeSettingsWindow extends EventEmitter {
  readonly webContents = new FakeWebContents()
  readonly isDestroyed = (): boolean => false
  readonly isMinimized = (): boolean => false
  readonly isMaximized = (): boolean => false
  readonly isVisible = (): boolean => false
  showCount = 0
  focusCount = 0

  show(): void {
    this.showCount += 1
  }

  showInactive(): void {}

  focus(): void {
    this.focusCount += 1
  }
}

test("settings presentation remains queued when navigation send races renderer reload", () => {
  const window = new FakeSettingsWindow()
  installWindowPresentation(window as unknown as BrowserWindow)

  const delivery = {
    revision: 1,
    rendererLoadEpoch: 1,
    payload: { tab: "extensions" }
  } as SettingsWindowNavigationDelivery

  assert.doesNotThrow(() => {
    showSettingsWindow(window as unknown as BrowserWindow, delivery)
  })
  assert.equal(window.webContents.sendCalls.length, 1)
  assert.equal(window.showCount, 0)

  window.emit("ready-to-show")

  assert.equal(window.showCount, 1)
  assert.equal(window.focusCount, 1)
})
