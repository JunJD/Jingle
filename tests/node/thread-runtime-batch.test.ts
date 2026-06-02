import assert from "node:assert/strict"
import test from "node:test"
import type { AgentThreadEvent, AgentThreadEventBatch } from "../../src/shared/agent-thread-runtime"
import { selectRuntimeEventsAfterRevision } from "../../src/renderer/src/lib/thread-runtime-batch"

function createStatusEvent(revision: number): AgentThreadEvent {
  return {
    error: null,
    revision,
    status: "running",
    type: "thread.statusChanged"
  }
}

function createBatch(revisions: number[], latestRevision = revisions.at(-1) ?? 0): AgentThreadEventBatch {
  return {
    events: revisions.map(createStatusEvent),
    latestRevision,
    threadId: "thread-a"
  }
}

test("runtime batch selector returns contiguous events after the current revision", () => {
  const selection = selectRuntimeEventsAfterRevision(2, createBatch([1, 2, 3, 4]))

  assert.equal(selection.type, "events")
  assert.deepEqual(
    selection.type === "events" ? selection.events.map((event) => event.revision) : [],
    [3, 4]
  )
})

test("runtime batch selector ignores fully stale batches", () => {
  const selection = selectRuntimeEventsAfterRevision(4, createBatch([2, 3, 4], 4))

  assert.deepEqual(selection, { type: "none" })
})

test("runtime batch selector reports a gap when the first new event skips a revision", () => {
  const selection = selectRuntimeEventsAfterRevision(2, createBatch([4]))

  assert.deepEqual(selection, {
    actualRevision: 4,
    expectedRevision: 3,
    type: "gap"
  })
})

test("runtime batch selector reports a gap when latestRevision is ahead of included events", () => {
  const selection = selectRuntimeEventsAfterRevision(2, createBatch([3], 4))

  assert.deepEqual(selection, {
    actualRevision: 4,
    expectedRevision: 4,
    type: "gap"
  })
})
