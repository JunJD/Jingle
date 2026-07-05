import assert from "node:assert/strict"
import test from "node:test"
import { createThreadStore } from "../../src/renderer/src/lib/thread-store-core"
import {
  mergeJingleSteeringAppliedMarkerMetadata,
  mergeJingleSteeringStatusMetadata,
  readJingleSteeringStatus
} from "../../src/shared/message-steering"

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

test("runtime steering user messages project as visible turns before and after acceptance", () => {
  const store = createThreadStore()

  store.applyRuntimeEvents("thread-a", [
    {
      message: { content: "Initial task", created_at: createdAt, id: "user-1", role: "user" },
      revision: 1,
      type: "message.upserted"
    },
    {
      revision: 2,
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
        turnId: "user-1",
        userMessageId: "user-1"
      },
      type: "run.started"
    },
    {
      message: {
        content: "Use the smaller fix",
        created_at: new Date("2026-01-01T00:00:01.000Z"),
        id: "steer-1",
        metadata: mergeJingleSteeringStatusMetadata(undefined, "pending"),
        role: "user"
      },
      revision: 3,
      type: "message.upserted"
    }
  ])

  const pendingProjection = store.getThreadState("thread-a")!.view.messageProjection
  const pendingTurn = pendingProjection.turns.at(-1)
  assert.equal(pendingTurn?.user?.id, "steer-1")
  assert.equal(pendingTurn?.user?.content, "Use the smaller fix")
  assert.equal(readJingleSteeringStatus(pendingTurn?.user?.metadata), "pending")
  assert.equal(pendingProjection.displayRows.some((row) => row.key === "steer-1"), true)

  store.applyRuntimeEvents("thread-a", [
    {
      message: {
        ...pendingTurn!.user!,
        metadata: mergeJingleSteeringStatusMetadata(pendingTurn!.user!.metadata, "applied")
      },
      revision: 4,
      type: "message.upserted"
    },
    {
      message: {
        content: "",
        created_at: new Date("2026-01-01T00:00:02.000Z"),
        id: "steer-applied:steer-1",
        metadata: mergeJingleSteeringAppliedMarkerMetadata(undefined, {
          kind: "applied",
          messageId: "steer-1",
          runId: "run-1"
        }),
        role: "system"
      },
      revision: 5,
      type: "message.upserted"
    },
    {
      appliedAt: new Date("2026-01-01T00:00:02.000Z"),
      messageId: "steer-1",
      revision: 6,
      runId: "run-1",
      type: "steer.applied"
    }
  ])

  const appliedProjection = store.getThreadState("thread-a")!.view.messageProjection
  const appliedTurn = appliedProjection.turns.at(-1)
  assert.equal(appliedTurn?.user?.id, "steer-1")
  assert.equal(appliedTurn?.user?.content, "Use the smaller fix")
  assert.equal(readJingleSteeringStatus(appliedTurn?.user?.metadata), "applied")
  assert.deepEqual(
    appliedProjection.displayRows.map((row) => row.kind),
    ["turn", "turn", "footer"]
  )

  store.applyRuntimeEvents("thread-a", [
    {
      message: {
        content: "Guided answer",
        created_at: new Date("2026-01-01T00:00:03.000Z"),
        id: "assistant-guided-1",
        role: "assistant"
      },
      revision: 7,
      type: "message.upserted"
    }
  ])

  const guidedProjection = store.getThreadState("thread-a")!.view.messageProjection
  assert.equal(guidedProjection.activeTurnKey, "steer-1")
  assert.equal(guidedProjection.activeAssistantId, "assistant-guided-1")
})
