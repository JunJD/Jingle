import assert from "node:assert/strict"
import test from "node:test"
import { createThreadStore } from "../../src/renderer/src/lib/thread-store-core"

const createdAt = new Date("2026-01-01T00:00:00.000Z")

test("runtime token deltas keep inactive turns and rows stable", () => {
  const store = createThreadStore()

  store.applyRuntimeEvents("thread-a", [
    {
      message: { content: "First", created_at: createdAt, id: "user-1", role: "user" },
      revision: 1,
      type: "message.upserted"
    },
    {
      message: { content: "Answer", created_at: createdAt, id: "assistant-1", role: "assistant" },
      revision: 2,
      type: "message.upserted"
    },
    {
      message: { content: "Second", created_at: createdAt, id: "user-2", role: "user" },
      revision: 3,
      type: "message.upserted"
    },
    {
      revision: 4,
      run: {
        assistantMessageId: null,
        currentToolCallId: null,
        phase: "thinking",
        phaseStartedAt: createdAt,
        runId: "run-1",
        startedAt: createdAt,
        status: "running",
        threadId: "thread-a",
        toolCalls: [],
        turnId: "user-2",
        userMessageId: "user-2"
      },
      type: "run.started"
    },
    {
      message: {
        content: "Streaming",
        created_at: createdAt,
        id: "assistant-2",
        role: "assistant"
      },
      revision: 5,
      type: "message.upserted"
    }
  ])
  const before = store.getThreadState("thread-a")!.view.messageProjection

  store.applyRuntimeEvents("thread-a", [
    {
      delta: " update",
      deltaAt: new Date("2026-01-01T00:00:01.000Z"),
      field: "text",
      messageId: "assistant-2",
      partId: "content",
      revision: 6,
      type: "message.part.delta"
    }
  ])
  const after = store.getThreadState("thread-a")!.view.messageProjection

  assert.equal(after.displayRows, before.displayRows)
  assert.equal(after.turns[0], before.turns[0])
  assert.notEqual(after.turns[1], before.turns[1])
  assert.equal(after.turns[1]?.assistants[0]?.content, "Streaming update")
})
