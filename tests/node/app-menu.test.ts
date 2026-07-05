import assert from "node:assert/strict"
import test from "node:test"
import { createApplicationMenuTemplate } from "../../src/main/app-menu"

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform
  })

  try {
    return fn()
  } finally {
    if (descriptor) {
      Object.defineProperty(process, "platform", descriptor)
    }
  }
}

test("macOS application menu uses the Jingle app label", () => {
  const template = withPlatform("darwin", () =>
    createApplicationMenuTemplate({
      isDev: true,
      launcherShortcutAccelerator: null,
      showLauncher: () => {},
      showMainSubject: () => {},
      showSettings: () => {}
    })
  )

  assert.equal(template[0]?.label, "Jingle")
  assert.equal(template[0]?.role, "appMenu")
})
