import assert from "node:assert/strict"
import test from "node:test"
import { createAppEntryMenu } from "../../src/main/app-entry"

test("app entry menu exposes launcher, settings, ipc network, and quit actions", () => {
  const menu = createAppEntryMenu({
    openIpcNetwork: () => {},
    openLauncher: () => {},
    openSettings: () => {},
    quit: () => {}
  })

  assert.deepEqual(
    menu.filter((item) => "label" in item).map((item) => item.label),
    ["Open Launcher", "Settings", "IPC Network", "Quit"]
  )
})

test("app entry menu omits IPC Network outside development", () => {
  const menu = createAppEntryMenu({
    openLauncher: () => {},
    openSettings: () => {},
    quit: () => {}
  })

  assert.deepEqual(
    menu.filter((item) => "label" in item).map((item) => item.label),
    ["Open Launcher", "Settings", "Quit"]
  )
})
