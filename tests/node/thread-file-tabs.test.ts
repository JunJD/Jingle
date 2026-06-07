import assert from "node:assert/strict"
import test from "node:test"
import { getFileTabId } from "../../src/shared/thread-tabs"
import { createThreadStore } from "../../src/renderer/src/lib/thread-store-core"

test("opening a workspace file uses a namespaced tab id", () => {
  const store = createThreadStore()

  store.getThreadActions("thread-a").openFile("agent", "agent")
  const state = store.getThreadState("thread-a")

  assert.ok(state)
  assert.deepEqual(state.ui.openFiles, [
    {
      name: "agent",
      path: "agent"
    }
  ])
  assert.equal(state.ui.activeTab, getFileTabId("agent"))
})
