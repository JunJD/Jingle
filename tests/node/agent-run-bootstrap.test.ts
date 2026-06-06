import assert from "node:assert/strict"
import test from "node:test"
import type { HITLRequest, Message } from "../../src/shared/app-types"
import { deriveActiveRunFromMessages } from "../../src/shared/agent-run-bootstrap"

function createMessage(input: { id: string; role: Message["role"]; content?: string }): Message {
  return {
    content: input.content ?? "",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    id: input.id,
    role: input.role
  }
}

function createPendingApproval(): HITLRequest {
  return {
    allowed_decisions: ["approve", "reject"],
    id: "hitl:thread-1:run-1:tool-1",
    review: null,
    tool_call: {
      args: {},
      id: "tool-1",
      name: "bash",
      type: "tool_call"
    }
  }
}

test("deriveActiveRunFromMessages derives a running turn from the latest user message", () => {
  const activeRun = deriveActiveRunFromMessages({
    latestRunId: "run-1",
    messages: [
      createMessage({ content: "first", id: "user-1", role: "user" }),
      createMessage({ content: "done", id: "assistant-1", role: "assistant" }),
      createMessage({ content: "second", id: "user-2", role: "user" })
    ],
    pendingApproval: null,
    threadId: "thread-1",
    threadStatus: "busy"
  })

  assert.deepEqual(activeRun, {
    assistantMessageId: null,
    phase: "thinking",
    runId: "run-1",
    status: "running",
    threadId: "thread-1",
    turnId: "user-2",
    userMessageId: "user-2"
  })
})

test("deriveActiveRunFromMessages derives waiting approval from the latest interrupted turn", () => {
  const activeRun = deriveActiveRunFromMessages({
    latestRunId: "run-1",
    messages: [
      createMessage({ content: "first", id: "user-1", role: "user" }),
      createMessage({ content: "done", id: "assistant-1", role: "assistant" }),
      createMessage({ content: "second", id: "user-2", role: "user" }),
      createMessage({ content: "", id: "assistant-2", role: "assistant" })
    ],
    pendingApproval: createPendingApproval(),
    threadId: "thread-1",
    threadStatus: "interrupted"
  })

  assert.deepEqual(activeRun, {
    assistantMessageId: "assistant-2",
    phase: "waiting_tool_result",
    runId: "run-1",
    status: "waiting_approval",
    threadId: "thread-1",
    turnId: "user-2",
    userMessageId: "user-2"
  })
})

test("deriveActiveRunFromMessages derives a resumable interrupted run without approval", () => {
  const activeRun = deriveActiveRunFromMessages({
    latestRunId: "run-1",
    messages: [
      createMessage({ content: "first", id: "user-1", role: "user" }),
      createMessage({ content: "second", id: "assistant-1", role: "assistant" })
    ],
    pendingApproval: null,
    threadId: "thread-1",
    threadStatus: "interrupted"
  })

  assert.deepEqual(activeRun, {
    assistantMessageId: "assistant-1",
    phase: "waiting_tool_result",
    runId: "run-1",
    status: "running",
    threadId: "thread-1",
    turnId: "user-1",
    userMessageId: "user-1"
  })
})
