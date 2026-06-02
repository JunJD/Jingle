import assert from "node:assert/strict"
import test from "node:test"
import type {
  ActiveAgentRun,
  AgentThreadEvent,
  AgentThreadSnapshot
} from "../../src/shared/agent-thread-runtime"
import {
  createDefaultAgentThreadRuntimeState,
  reduceAgentThreadRuntimeEvent
} from "../../src/shared/agent-thread-runtime"
import type { HITLRequest } from "../../src/shared/hitl"
import type { Message } from "../../src/shared/app-types"

function createActiveRun(): ActiveAgentRun {
  return {
    assistantMessageId: null,
    phase: "thinking",
    runId: null,
    status: "running",
    threadId: "thread-1",
    turnId: "user-1",
    userMessageId: "user-1"
  }
}

function createSnapshot(
  input: Partial<AgentThreadSnapshot> & {
    threadId: string
  }
): AgentThreadSnapshot {
  return {
    activeRun: null,
    error: null,
    hasMoreBefore: false,
    latestRunId: null,
    messagesPage: [],
    pendingApproval: null,
    revision: 0,
    status: "idle",
    subagents: [],
    todos: [],
    tokenUsage: null,
    ...input
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

function createAssistantMessage(id: string, content = ""): Message {
  return {
    content,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    id,
    role: "assistant"
  }
}

test("agent thread runtime reducer advances revision through run, message, tool, approval, and finish events", () => {
  const events: AgentThreadEvent[] = [
    {
      revision: 1,
      run: createActiveRun(),
      type: "run.started"
    },
    {
      revision: 2,
      runId: "run-1",
      type: "run.idAssigned"
    },
    {
      message: createAssistantMessage("assistant-1"),
      revision: 3,
      type: "message.upserted"
    },
    {
      delta: "hello",
      field: "text",
      messageId: "assistant-1",
      partId: "content",
      revision: 4,
      type: "message.part.delta"
    },
    {
      messageId: "assistant-1",
      revision: 5,
      runId: "run-1",
      toolCallId: "tool-1",
      type: "tool.started"
    },
    {
      approval: {
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
      revision: 6,
      runId: "run-1",
      type: "approval.requested"
    },
    {
      revision: 7,
      runId: "run-1",
      status: "completed",
      type: "run.finished"
    }
  ]

  const state = events.reduce(
    reduceAgentThreadRuntimeEvent,
    createDefaultAgentThreadRuntimeState("thread-1")
  )

  assert.equal(state.revision, 7)
  assert.equal(state.activeRun, null)
  assert.equal(state.messagesPage[0]?.content, "hello")
})

test("agent thread runtime ignores token deltas until the assistant message exists", () => {
  const baseState = reduceAgentThreadRuntimeEvent(createDefaultAgentThreadRuntimeState("thread-1"), {
    revision: 1,
    run: createActiveRun(),
    type: "run.started"
  })
  const unknownDeltaState = reduceAgentThreadRuntimeEvent(baseState, {
    delta: "late",
    field: "text",
    messageId: "assistant-1",
    partId: "content",
    revision: 2,
    type: "message.part.delta"
  })
  assert.equal(unknownDeltaState, baseState)

  const messageState = reduceAgentThreadRuntimeEvent(baseState, {
    message: createAssistantMessage("assistant-1", "hello"),
    revision: 2,
    type: "message.upserted"
  })
  const streamedState = reduceAgentThreadRuntimeEvent(messageState, {
    delta: " world",
    field: "text",
    messageId: "assistant-1",
    partId: "content",
    revision: 3,
    type: "message.part.delta"
  })

  assert.equal(streamedState.revision, 3)
  assert.equal(streamedState.activeRun?.assistantMessageId, "assistant-1")
  assert.equal(streamedState.messagesPage[0]?.content, "hello world")
})

test("agent thread runtime preserves pending approval while a paused run resumes", () => {
  const pendingApproval = createPendingApproval()
  const interruptedState = reduceAgentThreadRuntimeEvent(
    createDefaultAgentThreadRuntimeState("thread-1"),
    {
      revision: 1,
      snapshot: createSnapshot({
        activeRun: {
          ...createActiveRun(),
          phase: "waiting_tool_result",
          runId: "run-1",
          status: "waiting_approval"
        },
        latestRunId: "run-1",
        pendingApproval,
        revision: 1,
        status: "interrupted",
        threadId: "thread-1"
      }),
      type: "thread.snapshot"
    }
  )
  const resumedState = reduceAgentThreadRuntimeEvent(interruptedState, {
    revision: 2,
    run: {
      ...createActiveRun(),
      runId: "run-1"
    },
    type: "run.resumed"
  })
  const clearedState = reduceAgentThreadRuntimeEvent(resumedState, {
    revision: 3,
    type: "approval.cleared"
  })

  assert.equal(resumedState.status, "running")
  assert.equal(resumedState.pendingApproval, pendingApproval)
  assert.equal(clearedState.pendingApproval, null)
})

test("agent thread runtime snapshot restores active run and revision for late subscribers", () => {
  const activeRun = createActiveRun()
  const state = reduceAgentThreadRuntimeEvent(createDefaultAgentThreadRuntimeState("thread-1"), {
    revision: 7,
    snapshot: createSnapshot({
      activeRun,
      revision: 7,
      threadId: "thread-1"
    }),
    type: "thread.snapshot"
  })

  assert.equal(state.revision, 7)
  assert.deepEqual(state.activeRun, activeRun)
})

test("agent thread runtime snapshot restores thread facts and ignores stale revisions", () => {
  const pendingApproval = createPendingApproval()
  const state = reduceAgentThreadRuntimeEvent(createDefaultAgentThreadRuntimeState("thread-1"), {
    revision: 7,
    snapshot: createSnapshot({
      activeRun: {
        ...createActiveRun(),
        phase: "waiting_tool_result",
        runId: "run-1",
        status: "waiting_approval"
      },
      latestRunId: "run-1",
      pendingApproval,
      revision: 7,
      status: "interrupted",
      threadId: "thread-1",
      todos: [
        {
          content: "Review command",
          id: "todo-1",
          status: "pending"
        }
      ],
      tokenUsage: {
        inputTokens: 10,
        lastUpdated: new Date("2026-01-01T00:00:00.000Z"),
        outputTokens: 5,
        totalTokens: 15
      }
    }),
    type: "thread.snapshot"
  })
  const staleState = reduceAgentThreadRuntimeEvent(state, {
    revision: 6,
    runId: "run-1",
    status: "completed",
    type: "run.finished"
  })

  assert.equal(staleState, state)
  assert.equal(state.latestRunId, "run-1")
  assert.equal(state.pendingApproval, pendingApproval)
  assert.equal(state.status, "interrupted")
  assert.equal(state.todos[0]?.id, "todo-1")
  assert.equal(state.tokenUsage?.totalTokens, 15)
})
