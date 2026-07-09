import assert from "node:assert/strict"
import test from "node:test"
import {
  parseAgentCancelParams,
  parseAgentFollowUpQueueItemParams,
  parseAgentFollowUpQueueMessageParams,
  parseAgentFollowUpQueueRequestParams,
  parseAgentInvokeParams,
  parseAgentResumeParams,
  parseAgentSteerFollowUpParams
} from "../../src/main/agent/controller-schema"
import { IpcSchemaValidationError } from "../../src/main/ipc/schema"

test("parseAgentInvokeParams trims routing identifiers and preserves message content", () => {
  const parsed = parseAgentInvokeParams({
    threadId: "  thread-1  ",
    message: {
      id: "  message-1  ",
      content: [
        {
          type: "text",
          text: "hello"
        },
        {
          type: "image_url",
          image_url: {
            detail: "high",
            url: "  data:image/png;base64,aW1hZ2U=  "
          },
          mimeType: "  image/png  ",
          name: "  clipboard.png  "
        }
      ],
      refs: [
        {
          type: "file",
          name: "  plan.md  ",
          path: "  /tmp/plan.md  "
        },
        {
          type: "image",
          name: "  screenshot  ",
          url: "  https://example.com/screenshot.png  "
        },
        {
          type: "extension-source",
          extensionName: "  apple-reminders  ",
          name: "  Apple Reminders  ",
          sourceId: "  appleReminders  "
        },
        {
          type: "assistant-message-selection",
          selectedText: "  selected assistant text  ",
          sourceMessageId: "  assistant-message-1  ",
          sourceThreadId: "  thread-1  "
        }
      ]
    },
    modelId: "  gpt-5  ",
    permissionMode: "auto",
    expectedRunId: "  run-1  ",
    expectedTurnId: "  turn-1  ",
    followUpAction: "steer"
  })

  assert.deepEqual(parsed, {
    expectedRunId: "run-1",
    expectedTurnId: "turn-1",
    threadId: "thread-1",
    message: {
      id: "message-1",
      content: [
        {
          type: "text",
          text: "hello"
        },
        {
          type: "image_url",
          image_url: {
            detail: "high",
            url: "data:image/png;base64,aW1hZ2U="
          },
          mimeType: "image/png",
          name: "clipboard.png"
        }
      ],
      refs: [
        {
          type: "file",
          name: "plan.md",
          path: "/tmp/plan.md"
        },
        {
          type: "image",
          name: "screenshot",
          url: "https://example.com/screenshot.png"
        },
        {
          type: "extension-source",
          extensionName: "apple-reminders",
          name: "Apple Reminders",
          sourceId: "appleReminders"
        },
        {
          type: "assistant-message-selection",
          selectedText: "selected assistant text",
          sourceMessageId: "assistant-message-1",
          sourceThreadId: "thread-1"
        }
      ]
    },
    modelId: "gpt-5",
    permissionMode: "auto",
    followUpAction: "steer"
  })
})

test("parseAgentResumeParams requires request_id at the IPC boundary", () => {
  assert.throws(
    () =>
      parseAgentResumeParams({
        threadId: "thread-1",
        decision: {
          type: "approve"
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof IpcSchemaValidationError)
      assert.equal(error.channel, "agent:resume")
      assert.deepEqual(error.issues, [
        "decision.request_id: Invalid input: expected string, received undefined"
      ])
      return true
    }
  )
})

test("parseAgentInvokeParams rejects queue as a main-process follow-up action", () => {
  assert.throws(
    () =>
      parseAgentInvokeParams({
        threadId: "thread-1",
        message: {
          id: "message-1",
          content: "hello"
        },
        followUpAction: "queue"
      }),
    (error: unknown) => {
      assert.ok(error instanceof IpcSchemaValidationError)
      assert.equal(error.channel, "agent:invoke")
      assert.deepEqual(error.issues, ['followUpAction: Invalid input: expected "steer"'])
      return true
    }
  )
})

test("parseAgentFollowUpQueue params normalize queue command payloads", () => {
  assert.deepEqual(
    parseAgentFollowUpQueueMessageParams("agent:enqueueFollowUp", {
      messageInput: {
        refs: [
          {
            type: "file",
            name: "  plan.md  ",
            path: "  /tmp/plan.md  "
          }
        ],
        text: " queued follow-up "
      },
      threadId: " thread-1 "
    }),
    {
      messageInput: {
        refs: [
          {
            type: "file",
            name: "plan.md",
            path: "/tmp/plan.md"
          }
        ],
        text: " queued follow-up "
      },
      threadId: "thread-1"
    }
  )

  assert.deepEqual(
    parseAgentFollowUpQueueRequestParams("agent:takeFollowUp", {
      requestId: " request-1 ",
      threadId: " thread-1 "
    }),
    {
      requestId: "request-1",
      threadId: "thread-1"
    }
  )

  assert.deepEqual(
    parseAgentSteerFollowUpParams({
      expectedRunId: " run-1 ",
      expectedTurnId: " turn-1 ",
      requestId: " request-1 ",
      threadId: " thread-1 "
    }),
    {
      expectedRunId: "run-1",
      expectedTurnId: "turn-1",
      requestId: "request-1",
      threadId: "thread-1"
    }
  )

  assert.deepEqual(
    parseAgentSteerFollowUpParams({
      expectedRunId: null,
      expectedTurnId: null,
      requestId: " request-1 ",
      threadId: " thread-1 "
    }),
    {
      expectedRunId: null,
      expectedTurnId: null,
      requestId: "request-1",
      threadId: "thread-1"
    }
  )

  assert.deepEqual(
    parseAgentFollowUpQueueItemParams("agent:restoreFollowUp", {
      item: {
        messageInput: {
          refs: [],
          text: "queued follow-up"
        },
        requestId: " request-1 ",
        text: " queued follow-up "
      },
      threadId: " thread-1 "
    }),
    {
      item: {
        messageInput: {
          refs: [],
          text: "queued follow-up"
        },
        requestId: "request-1",
        text: " queued follow-up "
      },
      threadId: "thread-1"
    }
  )
})

test("parseAgentInvokeParams rejects unsupported permission mode", () => {
  assert.throws(
    () =>
      parseAgentInvokeParams({
        threadId: "thread-1",
        message: {
          id: "message-1",
          content: "hello"
        },
        permissionMode: "unsafe-auto"
      }),
    (error: unknown) => {
      assert.ok(error instanceof IpcSchemaValidationError)
      assert.equal(error.channel, "agent:invoke")
      assert.deepEqual(error.issues, [
        'permissionMode: Invalid option: expected one of "explore"|"ask-to-edit"|"auto"'
      ])
      return true
    }
  )
})

test("parseAgentResumeParams normalizes optional blank strings while keeping request_id required", () => {
  const parsed = parseAgentResumeParams({
    threadId: "  thread-1  ",
    decision: {
      type: "reject",
      request_id: "  request-1  ",
      tool_call_id: "  ",
      feedback: "  "
    },
    modelId: "  "
  })

  assert.deepEqual(parsed, {
    threadId: "thread-1",
    decision: {
      type: "reject",
      request_id: "request-1",
      tool_call_id: undefined,
      feedback: undefined
    },
    modelId: undefined
  })
})

test("parseAgentCancelParams rejects blank thread ids", () => {
  assert.throws(
    () =>
      parseAgentCancelParams({
        threadId: "   "
      }),
    (error: unknown) => {
      assert.ok(error instanceof IpcSchemaValidationError)
      assert.equal(error.channel, "agent:cancel")
      assert.deepEqual(error.issues, [
        "threadId: Too small: expected string to have >=1 characters"
      ])
      return true
    }
  )
})
