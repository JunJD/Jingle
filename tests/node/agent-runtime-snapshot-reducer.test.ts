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

test("agent runtime snapshot reducer applies messages, metadata, and run state in one state update", () => {
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
  assert.equal(next.agent.runId, "run-1")
  assert.equal(next.agent.activeRun, null)
})

test("agent runtime snapshot reducer preserves live runtime fields while thread is busy", () => {
  const defaultState = createDefaultThreadState()
  const state = {
    ...defaultState,
    agent: {
      ...defaultState.agent,
      activeRun: {
        assistantMessageId: "assistant-1",
        phase: "streaming" as const,
        runId: "run-1",
        status: "running" as const,
        threadId: "thread-1",
        turnId: "user-1",
        userMessageId: "user-1"
      },
      messages: [
        createMessage({ content: "hello", id: "user-1", role: "user" }),
        createMessage({ content: "streaming", id: "assistant-1", role: "assistant" })
      ],
      subagents: [
        {
          description: "Running task",
          id: "subagent-1",
          name: "Worker",
          status: "running" as const
        }
      ]
    }
  }

  const next = applyRuntimeSnapshotToThreadState(state, {
    thread: {
      metadata: {},
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

  assert.deepEqual(next.agent.activeRun, state.agent.activeRun)
  assert.deepEqual(next.agent.messages, state.agent.messages)
  assert.deepEqual(next.agent.subagents, state.agent.subagents)
})

test("agent runtime snapshot reducer derives a busy active run when no live runtime state exists yet", () => {
  const state = createDefaultThreadState()
  const next = applyRuntimeSnapshotToThreadState(state, {
    thread: {
      metadata: {},
      status: "busy",
      thread_id: "thread-1",
      title: "Busy Thread"
    },
    messages: {
      artifacts: [],
      messages: [createMessage({ content: "hello", id: "user-1", role: "user" })]
    },
    runState: {
      error: null,
      forkState: { canFork: false, reason: "busy" },
      pendingApproval: null,
      runId: "run-1",
      todos: []
    }
  } satisfies AgentThreadDataSnapshot)

  assert.equal(next.agent.activeRun?.status, "running")
  assert.equal(next.agent.activeRun?.turnId, "user-1")
  assert.equal(next.agent.activeRun?.runId, "run-1")
})

test("agent runtime snapshot reducer derives waiting approval active run for interrupted threads", () => {
  const state = createDefaultThreadState()
  const next = applyRuntimeSnapshotToThreadState(state, {
    thread: {
      metadata: {},
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

  assert.equal(next.agent.activeRun?.status, "waiting_approval")
  assert.equal(next.agent.activeRun?.assistantMessageId, "assistant-1")
  assert.equal(next.agent.activeRun?.turnId, "user-1")
  assert.equal(next.agent.pendingApproval?.id, "hitl:thread-1:run-1:tool-1")
})
