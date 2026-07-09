import assert from "node:assert/strict"
import test from "node:test"
import {
  buildAgentConnectThreadEventsIpcPayload,
  buildAgentInvokeIpcPayload,
  buildAgentResumeIpcPayload
} from "../../src/preload/api/agent-payload"

test("agent invoke IPC payload omits optional undefined fields", () => {
  const payload = buildAgentInvokeIpcPayload({
    followUpAction: undefined,
    message: {
      content: "没理解",
      id: "message-1"
    },
    modelId: "deepseek:deepseek-v4-pro",
    permissionMode: "ask-to-edit",
    temporaryMode: false,
    threadId: "thread-1"
  })

  assert.deepEqual(payload, {
    message: {
      content: "没理解",
      id: "message-1"
    },
    modelId: "deepseek:deepseek-v4-pro",
    permissionMode: "ask-to-edit",
    temporaryMode: false,
    threadId: "thread-1"
  })
  assert.equal(Object.hasOwn(payload, "followUpAction"), false)
  assert.equal(Object.hasOwn(payload, "expectedRunId"), false)
  assert.equal(Object.hasOwn(payload, "expectedTurnId"), false)
})

test("agent invoke IPC payload preserves follow-up steering identity", () => {
  assert.deepEqual(
    buildAgentInvokeIpcPayload({
      expectedRunId: "run-1",
      expectedTurnId: "turn-1",
      followUpAction: "steer",
      message: {
        content: "continue",
        id: "message-1"
      },
      threadId: "thread-1"
    }),
    {
      expectedRunId: "run-1",
      expectedTurnId: "turn-1",
      followUpAction: "steer",
      message: {
        content: "continue",
        id: "message-1"
      },
      threadId: "thread-1"
    }
  )
})

test("agent preload payload builders omit optional undefined route fields", () => {
  assert.deepEqual(
    buildAgentResumeIpcPayload({
      decision: {
        feedback: undefined,
        request_id: "request-1",
        tool_call_id: undefined,
        type: "approve"
      },
      modelId: undefined,
      threadId: "thread-1"
    }),
    {
      decision: {
        feedback: undefined,
        request_id: "request-1",
        tool_call_id: undefined,
        type: "approve"
      },
      threadId: "thread-1"
    }
  )

  assert.deepEqual(buildAgentConnectThreadEventsIpcPayload("thread-1", {}), {
    threadId: "thread-1"
  })
})
