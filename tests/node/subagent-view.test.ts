import assert from "node:assert/strict"
import test from "node:test"
import {
  countSubagents,
  getSubagentDurationLabel,
  getSubagentKanbanStatus,
  getSubagentStatusPresentation,
  getThreadKanbanStatus
} from "../../src/renderer/src/lib/subagent-view"
import type { Subagent } from "../../src/renderer/src/types"

function createSubagent(input: Partial<Subagent> & Pick<Subagent, "id" | "status">): Subagent {
  return {
    description: `${input.id} description`,
    name: `${input.id} name`,
    ...input
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

test("subagent view projects thread runtime facts to board status", () => {
  assert.equal(
    getThreadKanbanStatus({
      hasActiveRun: false,
      hasPendingApproval: true,
      threadStatus: "idle"
    }),
    "interrupted"
  )
  assert.equal(
    getThreadKanbanStatus({
      hasActiveRun: true,
      hasPendingApproval: false,
      threadStatus: "idle"
    }),
    "in_progress"
  )
  assert.equal(
    getThreadKanbanStatus({
      hasActiveRun: false,
      hasPendingApproval: false,
      threadStatus: "idle"
    }),
    "done"
  )
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
