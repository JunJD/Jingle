import assert from "node:assert/strict"
import test from "node:test"
import {
  countSubagents,
  getSubagentDurationLabel,
  getSubagentKanbanStatus,
  getSubagentStatusPresentation,
  projectSubagentKanbanBuckets,
  projectSubagentReferences
} from "../../src/renderer/src/lib/subagent-view"
import type { Subagent, Thread } from "../../src/renderer/src/types"

function createSubagent(input: Partial<Subagent> & Pick<Subagent, "id" | "status">): Subagent {
  return {
    description: `${input.id} description`,
    name: `${input.id} name`,
    ...input
  }
}

function createThread(threadId: string): Thread {
  return {
    created_at: new Date("2026-06-06T00:00:00.000Z"),
    status: "busy",
    thread_id: threadId,
    title: threadId,
    updated_at: new Date("2026-06-06T00:00:00.000Z")
  }
}

function createKanbanSourceState(subagents: readonly Subagent[]) {
  return {
    agent: {
      subagents
    }
  }
}

test("subagent view counts status buckets from runtime state", () => {
  const counts = countSubagents([
    createSubagent({ id: "a", status: "pending" }),
    createSubagent({ id: "b", status: "running" }),
    createSubagent({ id: "c", status: "completed" }),
    createSubagent({ id: "d", status: "failed" })
  ])

  assert.deepEqual(counts, {
    completed: 1,
    failed: 1,
    pending: 1,
    running: 1,
    total: 4
  })
})

test("subagent view projects references without exposing raw component mapping", () => {
  const references = projectSubagentReferences([
    createSubagent({
      id: "research-1",
      status: "running",
      subagentType: "research"
    })
  ])

  assert.deepEqual(references, [
    {
      detail: "research-1 description",
      key: "research-1",
      status: "running",
      subagentType: "research",
      title: "research-1 name"
    }
  ])
})

test("subagent view maps runtime statuses to presentation and board statuses", () => {
  assert.deepEqual(getSubagentStatusPresentation("running"), {
    badge: "info",
    className: "bg-status-info/20 text-status-info",
    label: "RUNNING"
  })
  assert.equal(getSubagentKanbanStatus("pending"), "pending")
  assert.equal(getSubagentKanbanStatus("running"), "in_progress")
  assert.equal(getSubagentKanbanStatus("completed"), "done")
  assert.equal(getSubagentKanbanStatus("failed"), "done")
})

test("subagent view builds kanban buckets from parent threads", () => {
  const threadAState = createKanbanSourceState([
    createSubagent({ id: "a", status: "running" }),
    createSubagent({ id: "b", status: "failed" })
  ])
  const missingThreadState = createKanbanSourceState([
    createSubagent({ id: "ignored", status: "pending" })
  ])

  const buckets = projectSubagentKanbanBuckets({
    enabled: true,
    statesByThreadId: {
      "thread-a": threadAState,
      missing: missingThreadState
    },
    threads: [createThread("thread-a")]
  })

  assert.equal(buckets.in_progress[0]?.subagent.id, "a")
  assert.equal(buckets.in_progress[0]?.parentThread.thread_id, "thread-a")
  assert.equal(buckets.done[0]?.subagent.id, "b")
  assert.deepEqual(buckets.pending, [])
  assert.deepEqual(buckets.interrupted, [])
})

test("subagent view keeps duration formatting pure and bounded", () => {
  assert.equal(
    getSubagentDurationLabel(
      createSubagent({
        completedAt: new Date("2026-06-06T00:00:03.500Z"),
        id: "timed",
        startedAt: new Date("2026-06-06T00:00:00.000Z"),
        status: "completed"
      })
    ),
    "3.5s"
  )
  assert.equal(getSubagentDurationLabel(createSubagent({ id: "untimed", status: "running" })), null)
})
