import assert from "node:assert/strict"
import test from "node:test"
import { createLauncherClipboardStore } from "../../src/renderer/src/launcher-shell/hooks/launcher-clipboard-store-core"

test("applyRefreshedContext exposes clipboard payloads and increments refreshSequence", () => {
  const store = createLauncherClipboardStore()

  store.getState().applyRefreshedContext({
    kind: "text",
    text: "hello"
  })

  assert.deepEqual(store.getState().candidateContext, {
    kind: "text",
    text: "hello"
  })
  assert.deepEqual(store.getState().acceptedContext, {
    kind: "none"
  })
  assert.equal(store.getState().refreshSequence, 1)

  store.getState().acceptContext()

  assert.deepEqual(store.getState().candidateContext, {
    kind: "none"
  })
  assert.deepEqual(store.getState().acceptedContext, {
    kind: "text",
    text: "hello"
  })
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
  store.getState().acceptContext()
  store.getState().clearContext()

  assert.deepEqual(store.getState().candidateContext, {
    kind: "none"
  })
  assert.deepEqual(store.getState().acceptedContext, {
    kind: "none"
  })
  assert.equal(store.getState().refreshSequence, 1)
})

test("refreshing the same dismissed payload keeps it dismissed", () => {
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

  assert.deepEqual(store.getState().candidateContext, {
    kind: "none"
  })
  assert.equal(store.getState().refreshSequence, 2)
})

test("refreshing the same accepted payload keeps it accepted", () => {
  const store = createLauncherClipboardStore()

  store.getState().applyRefreshedContext({
    kind: "text",
    text: "draft"
  })
  store.getState().acceptContext()
  store.getState().applyRefreshedContext({
    kind: "text",
    text: "draft"
  })

  assert.deepEqual(store.getState().acceptedContext, {
    kind: "text",
    text: "draft"
  })
  assert.deepEqual(store.getState().candidateContext, {
    kind: "none"
  })
  assert.equal(store.getState().refreshSequence, 2)
})

test("refreshing a changed payload restores a clipboard candidate", () => {
  const store = createLauncherClipboardStore()

  store.getState().applyRefreshedContext({
    kind: "text",
    text: "draft"
  })
  store.getState().clearContext()
  store.getState().applyRefreshedContext({
    kind: "text",
    text: "next draft"
  })

  assert.deepEqual(store.getState().candidateContext, {
    kind: "text",
    text: "next draft"
  })
  assert.equal(store.getState().refreshSequence, 2)
})
