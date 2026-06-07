import assert from "node:assert/strict"
import test from "node:test"
import type { ActiveAgentRun } from "../../src/shared/agent-thread-runtime"
import type { HITLRequest } from "../../src/shared/hitl"
import { projectThreadActivityStatus } from "../../src/renderer/src/lib/thread-view"

function createActiveRun(status: ActiveAgentRun["status"]): ActiveAgentRun {
  return {
    assistantMessageId: null,
    phase: "thinking",
    runId: "run-1",
    status,
    threadId: "thread-1",
    turnId: "user-1",
    userMessageId: "user-1"
  }
}

function createPendingApproval(): HITLRequest {
  return {
    allowed_decisions: ["approve", "reject"],
    id: "approval-1",
    review: null,
    tool_call: {
      args: {},
      id: "tool-1",
      name: "bash",
      type: "tool_call"
    }
  }
}

test("thread activity status projects runtime facts for display", () => {
  assert.equal(
    projectThreadActivityStatus({
      activeRun: createActiveRun("running"),
      pendingApproval: createPendingApproval()
    }),
    "running"
  )

  assert.equal(
    projectThreadActivityStatus({
      activeRun: null,
      pendingApproval: createPendingApproval()
    }),
    "interrupted"
  )

  assert.equal(
    projectThreadActivityStatus({
      activeRun: null,
      pendingApproval: null
    }),
    "idle"
  )
})
