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
      showMainWindow: () => {},
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

test("Help link failures remain recoverable and are reported to diagnostics", async () => {
  const failure = new Error("desktop shell unavailable")
  const openedUrls: string[] = []
  const reportedFailures: unknown[] = []
  let resolveReportedFailure: (() => void) | undefined
  const failureReported = new Promise<void>((resolve) => {
    resolveReportedFailure = resolve
  })
  const template = createApplicationMenuTemplate(
    {
      isDev: false,
      launcherShortcutAccelerator: null,
      showLauncher: () => {},
      showMainWindow: () => {},
      showSettings: () => {}
    },
    {
      openExternal: async (url) => {
        openedUrls.push(url)
        throw failure
      },
      reportHelpLinkFailure: (error) => {
        reportedFailures.push(error)
        resolveReportedFailure?.()
      }
    }
  )
  const helpItem = getSubmenu(template.find((item) => item.role === "help"))[0]

  assert.equal(typeof helpItem?.click, "function")
  helpItem.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent)

  await failureReported
  assert.deepEqual(reportedFailures, [failure])
  assert.deepEqual(openedUrls, ["https://github.com/JunJD/Jingle"])
})

test("a diagnostics failure cannot turn a Help link rejection into an unhandled rejection", async (context) => {
  let resolveConsoleError: ((message: unknown) => void) | undefined
  const consoleErrorReported = new Promise<unknown>((resolve) => {
    resolveConsoleError = resolve
  })
  const consoleError = context.mock.method(console, "error", (message) => {
    resolveConsoleError?.(message)
  })
  const template = createApplicationMenuTemplate(
    {
      isDev: false,
      launcherShortcutAccelerator: null,
      showLauncher: () => {},
      showMainWindow: () => {},
      showSettings: () => {}
    },
    {
      openExternal: async () => {
        throw new Error("desktop shell unavailable")
      },
      reportHelpLinkFailure: async () => {
        throw new Error("diagnostics unavailable")
      }
    }
  )
  const helpItem = getSubmenu(template.find((item) => item.role === "help"))[0]

  assert.equal(typeof helpItem?.click, "function")
  helpItem.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent)

  assert.equal(
    await consoleErrorReported,
    "[ApplicationMenu] Failed to record the help link failure."
  )
  assert.equal(consoleError.mock.callCount(), 1)
  assert.deepEqual(consoleError.mock.calls[0]?.arguments, [
    "[ApplicationMenu] Failed to record the help link failure."
  ])
})
