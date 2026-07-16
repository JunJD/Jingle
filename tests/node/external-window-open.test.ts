import assert from "node:assert/strict"
import test from "node:test"
import type { WebContents } from "electron"
import { installExternalWindowOpenHandler } from "../../src/main/windows/external-window-open"

type NavigationHandler = (
  event: Electron.Event<
    Electron.WebContentsWillFrameNavigateEventParams | Electron.WebContentsWillRedirectEventParams
  >
) => void

function createHarness(currentUrl: string) {
  const opened: string[] = []
  const navigationHandlers = new Map<string, NavigationHandler>()
  let windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null
  const webContents = {
    getURL: () => currentUrl,
    on: (event: string, handler: NavigationHandler) => {
      navigationHandlers.set(event, handler)
      return webContents
    },
    setWindowOpenHandler: (handler: typeof windowOpenHandler) => {
      windowOpenHandler = handler
    }
  } as unknown as WebContents

  installExternalWindowOpenHandler(webContents, {
    openExternal: async (url) => {
      opened.push(url)
    }
  })

  return {
    navigate(eventName: "will-frame-navigate" | "will-redirect", url: string, isMainFrame = true) {
      let prevented = false
      navigationHandlers.get(eventName)?.({
        defaultPrevented: false,
        frame: null,
        isMainFrame,
        isSameDocument: false,
        preventDefault: () => {
          prevented = true
        },
        url
      })
      return prevented
    },
    opened,
    openWindow(url: string) {
      assert.ok(windowOpenHandler)
      return windowOpenHandler({ url })
    }
  }
}

test("external navigation leaves the renderer document and opens in the system browser", () => {
  const harness = createHarness("file:///Applications/Jingle/renderer/index.html?window=settings")

  assert.equal(harness.navigate("will-frame-navigate", "https://example.com/docs"), true)
  assert.equal(harness.navigate("will-redirect", "file:///tmp/untrusted.html"), true)
  assert.equal(harness.navigate("will-redirect", "https://embed.example.com", false), true)
  assert.deepEqual(harness.openWindow("https://jingle.cool"), { action: "deny" })
  assert.deepEqual(harness.opened, [
    "https://example.com/docs",
    "file:///tmp/untrusted.html",
    "https://jingle.cool"
  ])
})

test("renderer reloads may keep the exact document identity", () => {
  const harness = createHarness("http://127.0.0.1:5173/?window=launcher")

  assert.equal(
    harness.navigate("will-frame-navigate", "http://127.0.0.1:5173/?window=launcher#chat"),
    false
  )
  assert.equal(
    harness.navigate("will-frame-navigate", "http://127.0.0.1:5173/?window=settings"),
    true
  )
  assert.deepEqual(harness.opened, ["http://127.0.0.1:5173/?window=settings"])
})
