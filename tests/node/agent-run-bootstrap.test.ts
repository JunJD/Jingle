import assert from "node:assert/strict"
import test from "node:test"
import type { HITLRequest, Message } from "../../src/shared/app-types"
import { deriveJingleActiveRunFromMessages } from "@jingle/agent-client"

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

test("deriveJingleActiveRunFromMessages derives a running turn from the latest user message", () => {
  const activeRun = deriveJingleActiveRunFromMessages({
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
    currentToolCallId: null,
    phase: "thinking",
    phaseStartedAt: new Date("2026-01-01T00:00:00.000Z"),
    runId: "run-1",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "running",
    threadId: "thread-1",
    toolCalls: [],
    turnId: "user-2",
    userMessageId: "user-2"
  })
})

test("deriveJingleActiveRunFromMessages derives waiting approval from the latest interrupted turn", () => {
  const activeRun = deriveJingleActiveRunFromMessages({
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
    currentToolCallId: "tool-1",
    phase: "waiting_tool_result",
    phaseStartedAt: new Date("2026-01-01T00:00:00.000Z"),
    runId: "run-1",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "waiting_approval",
    threadId: "thread-1",
    toolCalls: [
      {
        argsText: "{}",
        id: "tool-1",
        index: null,
        messageId: "assistant-2",
        name: "bash",
        runId: "run-1",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "waiting_result"
      }
    ],
    turnId: "user-2",
    userMessageId: "user-2"
  })
})

test("deriveJingleActiveRunFromMessages derives a resumable interrupted run without approval", () => {
  const activeRun = deriveJingleActiveRunFromMessages({
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
    currentToolCallId: null,
    phase: "waiting_tool_result",
    phaseStartedAt: new Date("2026-01-01T00:00:00.000Z"),
    runId: "run-1",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "running",
    threadId: "thread-1",
    toolCalls: [],
    turnId: "user-1",
    userMessageId: "user-1"
  })
})
