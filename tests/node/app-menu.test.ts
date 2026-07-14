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

function createTemplate(platform: NodeJS.Platform) {
  return withPlatform(platform, () =>
    createApplicationMenuTemplate({
      isDev: true,
      launcherShortcutAccelerator: null,
      showLauncher: () => {},
      showMainSubject: () => {},
      showSettings: () => {}
    })
  )
}

function getSubmenu(item: Electron.MenuItemConstructorOptions | undefined) {
  assert.ok(Array.isArray(item?.submenu))
  return item.submenu
}

test("macOS exposes Settings with its app-wide accelerator in the Jingle app menu", () => {
  const template = createTemplate("darwin")

  assert.equal(template[0]?.label, "Jingle")
  assert.equal(template[0]?.role, "appMenu")
  const settingsItems = getSubmenu(template[0]).filter((item) => item.label === "Settings")
  assert.equal(settingsItems.length, 1)
  assert.equal(settingsItems[0]?.accelerator, "CommandOrControl+,")
  assert.equal(
    getSubmenu(template.find((item) => item.label === "Window")).some(
      (item) => item.label === "Settings"
    ),
    false
  )
})

for (const platform of ["win32", "linux"] satisfies NodeJS.Platform[]) {
  test(`${platform} exposes Settings with its app-wide accelerator in the File menu`, () => {
    const template = createTemplate(platform)
    const settingsItems = getSubmenu(template.find((item) => item.label === "File")).filter(
      (item) => item.label === "Settings"
    )

    assert.equal(settingsItems.length, 1)
    assert.equal(settingsItems[0]?.accelerator, "CommandOrControl+,")
  })
}
