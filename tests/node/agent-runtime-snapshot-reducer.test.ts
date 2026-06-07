import assert from "node:assert/strict"
import test from "node:test"
import type { AgentThreadDataSnapshot, Message } from "../../src/shared/app-types"
import { DEFAULT_PERMISSION_MODE } from "../../src/shared/permission-mode"
import { applyRuntimeSnapshotToThreadState } from "../../src/renderer/src/lib/agent-runtime-snapshot-reducer"
import { createDefaultThreadState } from "../../src/renderer/src/lib/thread-store-core"

function createMessage(input: { content: string; id: string; role: Message["role"] }): Message {
  return {
    content: input.content,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    id: input.id,
    role: input.role
  }
}

test("agent runtime snapshot reducer applies messages, metadata, and non-runtime snapshot facts", () => {
  const state = createDefaultThreadState()
  const next = applyRuntimeSnapshotToThreadState(state, {
    thread: {
      metadata: {
        model: "openai:gpt-4o",
        workspacePath: "/tmp/demo",
        permissionMode: "ask-to-edit"
      },
      status: "idle",
      thread_id: "thread-1",
      title: "Demo"
    },
    messages: {
      artifacts: [],
      messages: [
        createMessage({ content: "hello", id: "user-1", role: "user" }),
        createMessage({ content: "world", id: "assistant-1", role: "assistant" })
      ]
    },
    runState: {
      error: null,
      forkState: { canFork: true },
      pendingApproval: null,
      runId: "run-1",
      todos: []
    }
  } satisfies AgentThreadDataSnapshot)

  assert.equal(next.agent.messages.length, 2)
  assert.equal(next.view.messageProjection.turns.length, 1)
  assert.equal(next.agent.currentModel, "openai:gpt-4o")
  assert.equal(next.agent.workspacePath, "/tmp/demo")
  assert.equal(next.agent.permissionMode, DEFAULT_PERMISSION_MODE)
  assert.equal(next.agent.runId, null)
  assert.equal(next.agent.activeRun, null)
})

test("agent runtime snapshot reducer does not produce runtime facts from snapshot run state", () => {
  const defaultState = createDefaultThreadState()
  const state = {
    ...defaultState,
    agent: {
      ...defaultState.agent,
      runId: "runtime-run",
      todos: [
        {
          content: "Runtime todo",
          id: "runtime-todo",
          status: "pending" as const
        }
      ],
      tokenUsage: {
        inputTokens: 10,
        lastUpdated: new Date("2026-01-01T00:00:00.000Z"),
        outputTokens: 5,
        totalTokens: 15
      }
    }
  }

  const next = applyRuntimeSnapshotToThreadState(state, {
    thread: {
      metadata: {},
      status: "idle",
      thread_id: "thread-1",
      title: undefined
    },
    messages: {
      artifacts: [],
      messages: []
    },
    runState: {
      error: null,
      forkState: { canFork: true },
      pendingApproval: null,
      runId: "snapshot-run",
      todos: [
        {
          content: "Snapshot todo",
          id: "snapshot-todo",
          status: "pending"
        }
      ]
    }
  } satisfies AgentThreadDataSnapshot)

  assert.equal(next.agent.runId, "runtime-run")
  assert.equal(next.agent.todos[0]?.id, "runtime-todo")
  assert.equal(next.agent.tokenUsage?.totalTokens, 15)
})

test("agent runtime snapshot reducer clears missing metadata instead of keeping stale source facts", () => {
  const defaultState = createDefaultThreadState()
  const state = {
    ...defaultState,
    agent: {
      ...defaultState.agent,
      currentModel: "stale:model",
      permissionMode: "auto" as const,
      title: "Stale title",
      workspacePath: "/tmp/stale"
    }
  }

  const next = applyRuntimeSnapshotToThreadState(state, {
    thread: {
      metadata: {},
      status: "idle",
      thread_id: "thread-1",
      title: undefined
    },
    messages: {
      artifacts: [],
      messages: []
    },
    runState: {
      error: null,
      forkState: { canFork: true },
      pendingApproval: null,
      runId: null,
      todos: []
    }
  } satisfies AgentThreadDataSnapshot)

  assert.notEqual(next.agent.currentModel, "stale:model")
  assert.equal(next.agent.permissionMode, DEFAULT_PERMISSION_MODE)
  assert.equal(next.agent.workspacePath, null)
})

test("agent runtime snapshot reducer applies only metadata from busy snapshots", () => {
  const state = createDefaultThreadState()
  const next = applyRuntimeSnapshotToThreadState(state, {
    thread: {
      metadata: {
        model: "openai:gpt-4o",
        workspacePath: "/tmp/busy"
      },
      status: "busy",
      thread_id: "thread-1",
      title: "Busy Thread"
    },
    messages: {
      artifacts: [],
      messages: [
        createMessage({ content: "hello", id: "user-1", role: "user" }),
        createMessage({ content: "history copy", id: "assistant-history", role: "assistant" })
      ]
    },
    runState: {
      error: null,
      forkState: { canFork: false, reason: "busy" },
      pendingApproval: null,
      runId: "run-1",
      todos: []
    }
  } satisfies AgentThreadDataSnapshot)

  assert.equal(next.agent.currentModel, "openai:gpt-4o")
  assert.equal(next.agent.workspacePath, "/tmp/busy")
  assert.equal(next.agent.activeRun, null)
  assert.deepEqual(next.agent.messages, [])
  assert.equal(next.agent.runId, null)
})

test("agent runtime snapshot reducer does not produce interrupted runtime facts", () => {
  const state = createDefaultThreadState()
  const next = applyRuntimeSnapshotToThreadState(state, {
    thread: {
      metadata: {
        model: "openai:gpt-4o",
        workspacePath: "/tmp/interrupted"
      },
      status: "interrupted",
      thread_id: "thread-1",
      title: "Interrupted Thread"
    },
    messages: {
      artifacts: [],
      messages: [
        createMessage({ content: "hello", id: "user-1", role: "user" }),
        {
          ...createMessage({ content: "", id: "assistant-1", role: "assistant" }),
          tool_calls: [
            {
              args: {},
              id: "tool-1",
              name: "bash",
              type: "tool_call"
            }
          ]
        }
      ]
    },
    runState: {
      error: null,
      forkState: { canFork: false, reason: "pending_hitl" },
      pendingApproval: {
        allowed_decisions: ["approve", "reject"],
        id: "hitl:thread-1:run-1:tool-1",
        review: null,
        tool_call: {
          args: {},
          id: "tool-1",
          name: "bash",
          type: "tool_call"
        }
      },
      runId: "run-1",
      todos: []
    }
  } satisfies AgentThreadDataSnapshot)

  assert.equal(next.agent.currentModel, "openai:gpt-4o")
  assert.equal(next.agent.workspacePath, "/tmp/interrupted")
  assert.equal(next.agent.activeRun, null)
  assert.equal(next.agent.pendingApproval, null)
  assert.equal(next.agent.runId, null)
  assert.deepEqual(next.agent.todos, [])
  assert.equal(next.agent.tokenUsage, null)
})
