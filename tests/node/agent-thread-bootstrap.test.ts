import assert from "node:assert/strict"
import test from "node:test"
import type { AgentThreadDataSnapshot, HITLRequest, Message } from "../../src/shared/app-types"
import { deriveThreadBootstrapState } from "../../src/shared/agent-thread-bootstrap"
import { createLegacyAgentRunFailure } from "../../src/shared/agent-run-failure"

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
    allowed_decisions: ["approve", "user_declined", "corrected"],
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

test("thread bootstrap derives interrupted state and approval-owned active run", () => {
  const bootstrap = deriveThreadBootstrapState({
    thread: {
      metadata: undefined,
      status: "interrupted",
      thread_id: "thread-1",
      title: undefined
    },
    messages: {
      artifacts: [],
      messages: [
        createMessage({ content: "hello", id: "user-1", role: "user" }),
        createMessage({ content: "", id: "assistant-1", role: "assistant" })
      ]
    },
    runState: {
      contextInclusions: [],
      error: null,
      forkState: { canFork: false, reason: "pending_hitl" },
      pendingApproval: createPendingApproval(),
      runId: "run-1",
      todos: [],
      workspacePath: null
    }
  } satisfies AgentThreadDataSnapshot)

  assert.equal(bootstrap.status, "interrupted")
  assert.equal(bootstrap.latestRunId, "run-1")
  assert.equal(bootstrap.pendingApproval?.id, "hitl:thread-1:run-1:tool-1")
  assert.equal(bootstrap.activeRun?.status, "waiting_approval")
  assert.equal(bootstrap.activeRun?.assistantMessageId, "assistant-1")
})

test("thread bootstrap maps persisted error string into runtime error payload", () => {
  const bootstrap = deriveThreadBootstrapState({
    thread: {
      metadata: undefined,
      status: "error",
      thread_id: "thread-1",
      title: undefined
    },
    messages: {
      artifacts: [],
      messages: []
    },
    runState: {
      contextInclusions: [],
      error: createLegacyAgentRunFailure("boom"),
      forkState: { canFork: true },
      pendingApproval: null,
      runId: "run-1",
      todos: [],
      workspacePath: null
    }
  } satisfies AgentThreadDataSnapshot)

  assert.equal(bootstrap.status, "error")
  assert.equal(bootstrap.error?.message, "boom")
  assert.equal(bootstrap.error?.status, 500)
  assert.equal(bootstrap.activeRun, null)
})

test("thread bootstrap preserves persisted context inclusions", () => {
  const bootstrap = deriveThreadBootstrapState({
    thread: {
      metadata: undefined,
      status: "idle",
      thread_id: "thread-1",
      title: undefined
    },
    messages: {
      artifacts: [],
      messages: []
    },
    runState: {
      contextInclusions: [
        {
          availability: "available",
          createdAt: 123,
          id: "ctx:run-1:provided:memory:memory-1",
          messageId: null,
          mode: "provided",
          preview: "Memory preview",
          runId: "run-1",
          sourceId: "memory-1",
          sourceType: "memory",
          target: {
            memoryId: "memory-1",
            type: "memory"
          },
          threadId: "thread-1",
          title: "Personal memory",
          turnId: null
        }
      ],
      error: null,
      forkState: { canFork: true },
      pendingApproval: null,
      runId: "run-1",
      todos: [],
      workspacePath: null
    }
  } satisfies AgentThreadDataSnapshot)

  assert.equal(bootstrap.contextInclusions.length, 1)
  assert.equal(bootstrap.contextInclusions[0]?.id, "ctx:run-1:provided:memory:memory-1")
})
