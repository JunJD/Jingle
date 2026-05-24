import assert from "node:assert/strict"
import test from "node:test"
import { createLauncherClipboardStore } from "../../src/renderer/src/launcher-shell/hooks/launcher-clipboard-store-core"

test("applyRefreshedContext exposes clipboard payloads and increments refreshSequence", () => {
  const store = createLauncherClipboardStore()

  store.getState().applyRefreshedContext({
    kind: "text",
    text: "hello"
  })

  assert.deepEqual(store.getState().context, {
    kind: "text",
    text: "hello"
  })
  assert.equal(store.getState().contextKey, "text:hello")
  assert.equal(store.getState().refreshSequence, 1)
})

test("clearContext only dismisses the visible clipboard payload", () => {
  const store = createLauncherClipboardStore()

  store.getState().applyRefreshedContext({
    kind: "files",
    files: [
      {
        isDirectory: false,
        isFile: true,
        name: "a.txt",
        path: "/tmp/a.txt"
      }
    ]
  })
  store.getState().clearContext()

  assert.deepEqual(store.getState().context, {
    kind: "none"
  })
  assert.equal(store.getState().contextKey, "none")
  assert.equal(store.getState().refreshSequence, 1)
})

test("refreshing after a dismissal restores the new clipboard payload", () => {
  const store = createLauncherClipboardStore()

  store.getState().applyRefreshedContext({
    kind: "text",
    text: "draft"
  })
  store.getState().clearContext()
  store.getState().applyRefreshedContext({
    kind: "text",
    text: "draft"
  })

  assert.deepEqual(store.getState().context, {
    kind: "text",
    text: "draft"
  })
  assert.equal(store.getState().refreshSequence, 2)
})
