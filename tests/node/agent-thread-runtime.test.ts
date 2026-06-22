import assert from "node:assert/strict"
import test from "node:test"
import type { ActiveAgentRun, AgentThreadEvent } from "../../src/shared/agent-thread-runtime"
import {
  AGENT_TOOL_EXECUTION_METADATA_KEY,
  createDefaultAgentThreadRuntimeState,
  readAgentToolExecutionTiming,
  reduceAgentThreadRuntimeEvent
} from "../../src/shared/agent-thread-runtime"
import type { HITLRequest } from "../../src/shared/hitl"
import type { Message } from "../../src/shared/app-types"

const RUN_STARTED_AT = new Date("2026-01-01T00:00:00.000Z")
const FIRST_DELTA_AT = new Date("2026-01-01T00:00:01.000Z")
const TOOL_STARTED_AT = new Date("2026-01-01T00:00:02.000Z")
const TOOL_COMPLETED_AT = new Date("2026-01-01T00:00:03.000Z")
const APPROVAL_REQUESTED_AT = new Date("2026-01-01T00:00:04.000Z")
const APPROVAL_RESOLVED_AT = new Date("2026-01-01T00:00:05.000Z")
const RUN_COMPLETED_AT = new Date("2026-01-01T00:00:06.000Z")

function createActiveRun(): ActiveAgentRun {
  return {
    assistantMessageId: null,
    currentToolCallId: null,
    phase: "thinking",
    phaseStartedAt: RUN_STARTED_AT,
    runId: null,
    startedAt: RUN_STARTED_AT,
    status: "running",
    threadId: "thread-1",
    toolCalls: [],
    turnId: "user-1",
    userMessageId: "user-1"
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
      deltaAt: FIRST_DELTA_AT,
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
      startedAt: TOOL_STARTED_AT,
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
      requestedAt: APPROVAL_REQUESTED_AT,
      revision: 6,
      runId: "run-1",
      type: "approval.requested"
    },
    {
      completedAt: RUN_COMPLETED_AT,
      durationMs: 6_000,
      error: null,
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
  const baseState = reduceAgentThreadRuntimeEvent(
    createDefaultAgentThreadRuntimeState("thread-1"),
    {
      revision: 1,
      run: createActiveRun(),
      type: "run.started"
    }
  )
  const unknownDeltaState = reduceAgentThreadRuntimeEvent(baseState, {
    delta: "late",
    deltaAt: FIRST_DELTA_AT,
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
    deltaAt: FIRST_DELTA_AT,
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

test("agent thread runtime exposes streaming tool call facts until the tool result arrives", () => {
  const startedState = reduceAgentThreadRuntimeEvent(
    createDefaultAgentThreadRuntimeState("thread-1"),
    {
      revision: 1,
      run: createActiveRun(),
      type: "run.started"
    }
  )
  const toolCallStartedAt = new Date("2026-01-01T00:00:00.000Z")
  const toolStreamingState = reduceAgentThreadRuntimeEvent(startedState, {
    revision: 2,
    toolCall: {
      argsText: '{"path":"src/',
      id: "tool-1",
      index: 0,
      messageId: "assistant-1",
      name: "edit_file",
      runId: "run-1",
      startedAt: toolCallStartedAt,
      status: "arguments_streaming"
    },
    type: "tool.callUpdated"
  })

  assert.equal(toolStreamingState.activeRun?.assistantMessageId, "assistant-1")
  assert.equal(toolStreamingState.activeRun?.currentToolCallId, "tool-1")
  assert.equal(toolStreamingState.activeRun?.phase, "tool_running")
  assert.deepEqual(toolStreamingState.activeRun?.toolCalls, [
    {
      argsText: '{"path":"src/',
      id: "tool-1",
      index: 0,
      messageId: "assistant-1",
      name: "edit_file",
      runId: "run-1",
      startedAt: toolCallStartedAt,
      status: "arguments_streaming"
    }
  ])

  const toolResultMessageState = reduceAgentThreadRuntimeEvent(toolStreamingState, {
    message: {
      content: "done",
      created_at: new Date("2026-01-01T00:00:01.000Z"),
      id: "tool-result-1",
      role: "tool",
      tool_call_id: "tool-1"
    },
    revision: 3,
    type: "message.upserted"
  })
  const completedState = reduceAgentThreadRuntimeEvent(toolResultMessageState, {
    completedAt: TOOL_COMPLETED_AT,
    durationMs: 1_000,
    error: null,
    messageId: "assistant-1",
    revision: 4,
    runId: "run-1",
    startedAt: toolCallStartedAt,
    status: "completed",
    toolCallId: "tool-1",
    toolName: "edit_file",
    type: "tool.updated"
  })

  assert.equal(completedState.activeRun?.currentToolCallId, null)
  assert.deepEqual(completedState.activeRun?.toolCalls, [])
  assert.equal(completedState.activeRun?.phase, "thinking")
})

test("agent thread runtime keeps running tool phase until all active tools complete", () => {
  const startedState = reduceAgentThreadRuntimeEvent(
    createDefaultAgentThreadRuntimeState("thread-1"),
    {
      revision: 1,
      run: createActiveRun(),
      type: "run.started"
    }
  )
  const firstToolStartedAt = new Date("2026-01-01T00:00:01.000Z")
  const secondToolStartedAt = new Date("2026-01-01T00:00:02.000Z")
  const firstToolRunningState = reduceAgentThreadRuntimeEvent(startedState, {
    revision: 2,
    toolCall: {
      argsText: "{}",
      id: "tool-1",
      index: 0,
      messageId: "assistant-1",
      name: "read_file",
      runId: "run-1",
      startedAt: firstToolStartedAt,
      status: "running"
    },
    type: "tool.callUpdated"
  })
  const secondToolRunningState = reduceAgentThreadRuntimeEvent(firstToolRunningState, {
    revision: 3,
    toolCall: {
      argsText: "{}",
      id: "tool-2",
      index: 1,
      messageId: "assistant-1",
      name: "grep",
      runId: "run-1",
      startedAt: secondToolStartedAt,
      status: "running"
    },
    type: "tool.callUpdated"
  })

  const firstToolCompletedState = reduceAgentThreadRuntimeEvent(secondToolRunningState, {
    completedAt: TOOL_COMPLETED_AT,
    durationMs: 2_000,
    error: null,
    messageId: "assistant-1",
    revision: 4,
    runId: "run-1",
    startedAt: firstToolStartedAt,
    status: "completed",
    toolCallId: "tool-1",
    toolName: "read_file",
    type: "tool.updated"
  })

  assert.equal(firstToolCompletedState.activeRun?.phase, "tool_running")
  assert.equal(firstToolCompletedState.activeRun?.currentToolCallId, "tool-2")
  assert.deepEqual(
    firstToolCompletedState.activeRun?.toolCalls.map((toolCall) => toolCall.id),
    ["tool-2"]
  )
})

test("agent thread runtime preserves pending approval while a paused run resumes", () => {
  const pendingApproval = createPendingApproval()
  const startedState = reduceAgentThreadRuntimeEvent(
    createDefaultAgentThreadRuntimeState("thread-1"),
    {
      revision: 1,
      run: createActiveRun(),
      type: "run.started"
    }
  )
  const assignedState = reduceAgentThreadRuntimeEvent(startedState, {
    revision: 2,
    runId: "run-1",
    type: "run.idAssigned"
  })
  const interruptedState = reduceAgentThreadRuntimeEvent(assignedState, {
    approval: pendingApproval,
    requestedAt: APPROVAL_REQUESTED_AT,
    revision: 3,
    runId: "run-1",
    type: "approval.requested"
  })
  const resumedState = reduceAgentThreadRuntimeEvent(interruptedState, {
    revision: 4,
    run: {
      ...createActiveRun(),
      runId: "run-1"
    },
    type: "run.resumed"
  })
  const clearedState = reduceAgentThreadRuntimeEvent(resumedState, {
    decision: { request_id: pendingApproval.id, tool_call_id: "tool-1", type: "approve" },
    revision: 5,
    resolvedAt: APPROVAL_RESOLVED_AT,
    type: "approval.cleared"
  })

  assert.equal(resumedState.status, "running")
  assert.equal(resumedState.pendingApproval, pendingApproval)
  assert.equal(clearedState.pendingApproval, null)
  assert.equal(clearedState.activeRun?.phaseStartedAt, APPROVAL_RESOLVED_AT)
  assert.equal(clearedState.activeRun?.toolCalls[0]?.status, "running")
})

test("agent thread runtime ignores stale event revisions", () => {
  const state = reduceAgentThreadRuntimeEvent(createDefaultAgentThreadRuntimeState("thread-1"), {
    revision: 7,
    run: createActiveRun(),
    type: "run.started"
  })
  const staleState = reduceAgentThreadRuntimeEvent(state, {
    completedAt: RUN_COMPLETED_AT,
    durationMs: 6_000,
    error: null,
    revision: 6,
    runId: "run-1",
    status: "completed",
    type: "run.finished"
  })

  assert.equal(staleState, state)
  assert.equal(state.revision, 7)
  assert.equal(state.status, "running")
})

test("agent thread runtime records tool execution timing and failure metadata", () => {
  const startedState = reduceAgentThreadRuntimeEvent(
    createDefaultAgentThreadRuntimeState("thread-1"),
    {
      revision: 1,
      run: createActiveRun(),
      type: "run.started"
    }
  )
  const toolRunningState = reduceAgentThreadRuntimeEvent(startedState, {
    messageId: "assistant-1",
    revision: 2,
    runId: "run-1",
    startedAt: TOOL_STARTED_AT,
    toolCallId: "tool-1",
    type: "tool.started"
  })
  const toolCompletedState = reduceAgentThreadRuntimeEvent(toolRunningState, {
    completedAt: TOOL_COMPLETED_AT,
    durationMs: 1_000,
    error: { message: "Command failed" },
    messageId: "assistant-1",
    revision: 3,
    runId: "run-1",
    startedAt: TOOL_STARTED_AT,
    status: "failed",
    toolCallId: "tool-1",
    toolName: "bash",
    type: "tool.updated"
  })

  assert.equal(toolRunningState.activeRun?.phaseStartedAt, TOOL_STARTED_AT)
  assert.equal(toolCompletedState.activeRun?.phase, "thinking")
  assert.equal(toolCompletedState.activeRun?.phaseStartedAt, TOOL_COMPLETED_AT)
  assert.deepEqual(toolCompletedState.activeRun?.toolCalls, [])

  const toolMessage: Message = {
    content: "failed",
    created_at: TOOL_COMPLETED_AT,
    id: "tool-result-1",
    metadata: {
      [AGENT_TOOL_EXECUTION_METADATA_KEY]: {
        completedAt: TOOL_COMPLETED_AT.toISOString(),
        durationMs: 1_000,
        error: { message: "Command failed" },
        messageId: "tool-result-1",
        runId: "run-1",
        startedAt: TOOL_STARTED_AT.toISOString(),
        status: "failed",
        toolCallId: "tool-1",
        toolName: "bash"
      }
    },
    role: "tool",
    tool_call_id: "tool-1"
  }
  const timing = readAgentToolExecutionTiming(toolMessage)
  assert.equal(timing?.status, "failed")
  assert.equal(timing?.durationMs, 1_000)
  assert.equal(timing?.startedAt?.getTime(), TOOL_STARTED_AT.getTime())
  assert.equal(timing?.completedAt?.getTime(), TOOL_COMPLETED_AT.getTime())
  assert.equal(timing?.error?.message, "Command failed")
})

test("agent thread runtime reads completed tool facts without fabricating a start time", () => {
  const toolMessage: Message = {
    content: "done",
    created_at: TOOL_COMPLETED_AT,
    id: "tool-result-1",
    metadata: {
      [AGENT_TOOL_EXECUTION_METADATA_KEY]: {
        completedAt: TOOL_COMPLETED_AT.toISOString(),
        messageId: "tool-result-1",
        runId: "run-1",
        status: "completed",
        toolCallId: "tool-1",
        toolName: "bash"
      }
    },
    role: "tool",
    tool_call_id: "tool-1"
  }

  const timing = readAgentToolExecutionTiming(toolMessage)

  assert.equal(timing?.status, "completed")
  assert.equal(timing?.startedAt, undefined)
  assert.equal(timing?.durationMs, undefined)
  assert.equal(timing?.completedAt?.getTime(), TOOL_COMPLETED_AT.getTime())
})

test("agent thread runtime truncates messages after an edited user message", () => {
  const startedState = reduceAgentThreadRuntimeEvent(
    createDefaultAgentThreadRuntimeState("thread-1"),
    {
      revision: 1,
      run: createActiveRun(),
      type: "run.started"
    }
  )
  const withUser = reduceAgentThreadRuntimeEvent(startedState, {
    message: {
      content: "edited question",
      created_at: RUN_STARTED_AT,
      id: "user-1",
      role: "user"
    },
    revision: 2,
    type: "message.upserted"
  })
  const withAssistant = reduceAgentThreadRuntimeEvent(withUser, {
    message: createAssistantMessage("assistant-1", "old answer"),
    revision: 3,
    type: "message.upserted"
  })
  const withApproval = reduceAgentThreadRuntimeEvent(withAssistant, {
    approval: createPendingApproval(),
    requestedAt: APPROVAL_REQUESTED_AT,
    revision: 4,
    runId: "run-1",
    type: "approval.requested"
  })

  const truncated = reduceAgentThreadRuntimeEvent(withApproval, {
    messageId: "user-1",
    revision: 5,
    type: "message.truncatedAfter"
  })

  assert.deepEqual(
    truncated.messagesPage.map((message) => message.id),
    ["user-1"]
  )
  assert.equal(truncated.pendingApproval, null)
  assert.equal(truncated.revision, 5)
})

test("agent thread runtime stores follow-up queue facts", () => {
  const queued = reduceAgentThreadRuntimeEvent(createDefaultAgentThreadRuntimeState("thread-1"), {
    revision: 1,
    summary: {
      count: 2,
      items: [
        {
          messageInput: { refs: [], text: "queued follow-up" },
          requestId: "request-1",
          text: "queued follow-up"
        }
      ],
      nextRequestId: "request-1"
    },
    type: "followUp.queueChanged"
  })

  assert.deepEqual(queued.followUpQueue, {
    count: 2,
    items: [
      {
        messageInput: { refs: [], text: "queued follow-up" },
        requestId: "request-1",
        text: "queued follow-up"
      }
    ],
    nextRequestId: "request-1"
  })
  assert.equal(queued.revision, 1)
})
