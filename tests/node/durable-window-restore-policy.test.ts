import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  DurableWindowRestoreGate,
  DurableWindowRestorePolicy,
  summarizeDurableWindowRestoreRepairs
} from "../../src/main/durable-window/restore-policy"

describe("DurableWindowRestorePolicy", () => {
  it("keeps the application-quitting restore gate monotonic", () => {
    const gate = new DurableWindowRestoreGate()

    assert.equal(gate.isApplicationQuitting(), false)
    gate.markApplicationQuitting()
    assert.equal(gate.isApplicationQuitting(), true)
  })

  it("distinguishes active, archived, missing, and unbound persisted bindings", async () => {
    const policy = new DurableWindowRestorePolicy({
      getThread: async (threadId) => {
        if (threadId === "active") return { archivedAt: null }
        if (threadId === "archived") return { archivedAt: 1 }
        return null
      }
    })

    assert.deepEqual(await policy.resolve(null), { action: "restore", threadId: null })
    assert.deepEqual(await policy.resolve("active"), {
      action: "restore",
      threadId: "active"
    })
    assert.deepEqual(await policy.resolve("archived"), {
      action: "discard",
      reason: "archived",
      threadId: "archived"
    })
    assert.deepEqual(await policy.resolve("missing"), {
      action: "discard",
      reason: "missing",
      threadId: "missing"
    })
  })

  it("bounds stale-binding diagnostics while retaining exact totals", () => {
    const discarded = Array.from({ length: 9 }, (_, index) => ({
      reason: index % 2 === 0 ? ("archived" as const) : ("missing" as const),
      threadId: `thread-${index}`,
      windowId: `window-${index}`
    }))

    const summary = summarizeDurableWindowRestoreRepairs("thread-window", discarded)

    assert.equal(summary.archivedBindingCount, 5)
    assert.equal(summary.missingBindingCount, 4)
    assert.equal(summary.sampleBindings.length, 5)
  })
})
