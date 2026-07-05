import assert from "node:assert/strict"
import test from "node:test"
import {
  createDefaultAgentThreadRuntimeState,
  type AgentThreadEvent
} from "../../src/shared/agent-thread-contract"
import {
  applyJingleRuntimeEvents,
  reduceJingleAgentThreadRuntimeEvent,
  selectRuntimeEventsAfterRevision,
  type JingleRuntimeEventBatch
} from "@jingle/agent-client"

function createStatusEvent(revision: number): AgentThreadEvent {
  return {
    error: null,
    revision,
    status: "running",
    type: "thread.statusChanged"
  }
}

function createBatch(
  revisions: number[],
  latestRevision = revisions.at(-1) ?? 0
): JingleRuntimeEventBatch<AgentThreadEvent> {
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

test("runtime event application advances source state and reports changed message deltas", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z")
  const initialState = createDefaultAgentThreadRuntimeState("thread-a")

  const messageResult = applyJingleRuntimeEvents(
    initialState,
    [
      {
        message: {
          content: "Hello",
          created_at: createdAt,
          id: "assistant-1",
          role: "assistant"
        },
        revision: 1,
        type: "message.upserted"
      }
    ],
    {
      readChangedMessageId: readChangedMessageIdFromRuntimeEvent,
      reduceEvent: reduceJingleAgentThreadRuntimeEvent
    }
  )

  assert.equal(messageResult.changed, true)
  assert.equal(messageResult.changedMessageId, null)
  assert.equal(messageResult.state.revision, 1)
  assert.equal(messageResult.state.messagesPage[0]?.content, "Hello")

  const deltaResult = applyJingleRuntimeEvents(
    messageResult.state,
    [
      {
        delta: " world",
        deltaAt: new Date("2026-01-01T00:00:01.000Z"),
        field: "text",
        messageId: "assistant-1",
        partId: "content",
        revision: 2,
        type: "message.part.delta"
      }
    ],
    {
      readChangedMessageId: readChangedMessageIdFromRuntimeEvent,
      reduceEvent: reduceJingleAgentThreadRuntimeEvent
    }
  )

  assert.equal(deltaResult.changed, true)
  assert.equal(deltaResult.changedMessageId, "assistant-1")
  assert.equal(deltaResult.state.messagesPage[0]?.content, "Hello world")
})

function readChangedMessageIdFromRuntimeEvent(event: AgentThreadEvent): string | null {
  return event.type === "message.part.delta" ? event.messageId : null
}
