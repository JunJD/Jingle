import assert from "node:assert/strict"
import test from "node:test"
import {
  applyJingleRuntimeSnapshotSourceState,
  resolveJingleSnapshotApplicationPolicy
} from "@jingle/agent-client"
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
      contextInclusions: [],
      error: null,
      forkState: { canFork: true },
      pendingApproval: null,
      runId: "run-1",
      todos: [],
      workspacePath: "/tmp/demo"
    }
  } satisfies AgentThreadDataSnapshot)

  assert.equal(next.agent.messagesPage.length, 2)
  assert.equal(next.view.messageProjection.turns.length, 1)
  assert.equal(next.agent.currentModel, "openai:gpt-4o")
  assert.equal(next.agent.workspacePath, "/tmp/demo")
  assert.equal(next.agent.permissionMode, DEFAULT_PERMISSION_MODE)
  assert.equal(next.agent.latestRunId, null)
  assert.equal(next.agent.activeRun, null)
})

test("agent runtime snapshot reducer hydrates context inclusions from run state", () => {
  const state = createDefaultThreadState()
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
      contextInclusions: [
        {
          availability: "available",
          createdAt: 123,
          id: "ctx:run-1:retrieved:history_message:thread-1:message-1",
          messageId: null,
          mode: "retrieved",
          preview: "Earlier answer",
          runId: "run-1",
          sourceId: "message-1",
          sourceType: "history_message",
          target: {
            messageId: "message-1",
            threadId: "thread-1",
            type: "history_message"
          },
          threadId: "thread-1",
          title: "assistant message",
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

  assert.equal(next.agent.contextInclusions.length, 1)
  assert.equal(next.agent.contextInclusions[0]?.sourceType, "history_message")
})

test("agent runtime snapshot reducer does not produce runtime facts from snapshot run state", () => {
  const defaultState = createDefaultThreadState()
  const state = {
    ...defaultState,
    agent: {
      ...defaultState.agent,
      latestRunId: "runtime-run",
      todos: [
        {
          content: "Runtime todo",
          id: "runtime-todo",
          status: "pending" as const
        }
      ],
      tokenUsage: {
        inputTokens: 10,
        lastUpdated: "2026-01-01T00:00:00.000Z",
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
      contextInclusions: [],
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
      ],
      workspacePath: null
    }
  } satisfies AgentThreadDataSnapshot)

  assert.equal(next.agent.latestRunId, "runtime-run")
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
      contextInclusions: [],
      error: null,
      forkState: { canFork: true },
      pendingApproval: null,
      runId: null,
      todos: [],
      workspacePath: null
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
        model: "openai:gpt-4o"
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
      contextInclusions: [],
      error: null,
      forkState: { canFork: false, reason: "busy" },
      pendingApproval: null,
      runId: "run-1",
      todos: [],
      workspacePath: "/tmp/busy"
    }
  } satisfies AgentThreadDataSnapshot)

  assert.equal(next.agent.currentModel, "openai:gpt-4o")
  assert.equal(next.agent.workspacePath, "/tmp/busy")
  assert.equal(next.agent.activeRun, null)
  assert.deepEqual(next.agent.messagesPage, [])
  assert.equal(next.agent.latestRunId, null)
})

test("agent runtime snapshot reducer does not produce interrupted runtime facts", () => {
  const state = createDefaultThreadState()
  const next = applyRuntimeSnapshotToThreadState(state, {
    thread: {
      metadata: {
        model: "openai:gpt-4o"
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
      contextInclusions: [],
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
      todos: [],
      workspacePath: "/tmp/interrupted"
    }
  } satisfies AgentThreadDataSnapshot)

  assert.equal(next.agent.currentModel, "openai:gpt-4o")
  assert.equal(next.agent.workspacePath, "/tmp/interrupted")
  assert.equal(next.agent.activeRun, null)
  assert.equal(next.agent.pendingApproval, null)
  assert.equal(next.agent.latestRunId, null)
  assert.deepEqual(next.agent.todos, [])
  assert.equal(next.agent.tokenUsage, null)
})

test("agent snapshot policy blocks stale snapshots from overwriting live runtime messages", () => {
  const policy = resolveJingleSnapshotApplicationPolicy({
    current: {
      activeRun: null,
      messagesPage: [
        createMessage({ content: "hello", id: "user-1", role: "user" }),
        createMessage({ content: "streaming answer", id: "assistant-1", role: "assistant" })
      ],
      revision: 2
    },
    snapshot: {
      messages: [
        createMessage({ content: "hello", id: "user-1", role: "user" }),
        createMessage({ content: "streaming", id: "assistant-1", role: "assistant" })
      ],
      status: "idle"
    }
  })

  assert.deepEqual(policy, {
    canApplyContent: false,
    canApplyRuntimeState: false,
    isLiveSnapshot: false,
    wouldRollbackRuntimeMessages: true
  })
})

test("jingle agent client applies snapshot source state without producing runtime facts", () => {
  const currentMessage = createMessage({
    content: "streaming answer",
    id: "assistant-1",
    role: "assistant"
  })
  const application = applyJingleRuntimeSnapshotSourceState({
    current: {
      activeRun: null,
      contextInclusions: [{ id: "runtime-context" }],
      error: null,
      followUpQueue: { nextRequestId: "follow-up-1" },
      latestRunId: "runtime-run",
      messagesPage: [currentMessage],
      pendingApproval: { id: "runtime-approval" },
      revision: 2,
      status: "running",
      todos: [{ id: "runtime-todo" }],
      tokenUsage: { totalTokens: 15 }
    },
    snapshot: {
      contextInclusions: [{ id: "snapshot-context" }],
      error: { message: "snapshot error" },
      messagesPage: [
        createMessage({
          content: "streaming",
          id: "assistant-1",
          role: "assistant"
        })
      ],
      sourceStatus: "idle",
      threadStatus: "idle"
    }
  })

  assert.equal(application.policy.canApplyContent, false)
  assert.deepEqual(application.state.messagesPage, [currentMessage])
  assert.deepEqual(application.state.contextInclusions, [{ id: "runtime-context" }])
  assert.deepEqual(application.state.error, null)
  assert.deepEqual(application.state.followUpQueue, { nextRequestId: "follow-up-1" })
  assert.deepEqual(application.state.pendingApproval, { id: "runtime-approval" })
  assert.deepEqual(application.state.todos, [{ id: "runtime-todo" }])
  assert.deepEqual(application.state.tokenUsage, { totalTokens: 15 })
})
