import assert from "node:assert/strict"
import test from "node:test"
import {
  parseAgentCancelParams,
  parseAgentInvokeParams,
  parseAgentResumeParams
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
            url: "  https://example.com/image.png  "
          }
        }
      ],
      additional_kwargs: {
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
          }
        ]
      }
    },
    modelId: "  gpt-5  ",
    permissionMode: "auto"
  })

  assert.deepEqual(parsed, {
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
            url: "https://example.com/image.png"
          }
        }
      ],
      additional_kwargs: {
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
          }
        ]
      }
    },
    modelId: "gpt-5",
    permissionMode: "auto"
  })
})

test("parseAgentResumeParams requires request_id at the IPC boundary", () => {
  assert.throws(
    () =>
      parseAgentResumeParams({
        threadId: "thread-1",
        command: {
          resume: {
            type: "approve"
          }
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof IpcSchemaValidationError)
      assert.equal(error.channel, "agent:resume")
      assert.deepEqual(error.issues, [
        "command.resume.request_id: Invalid input: expected string, received undefined"
      ])
      return true
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
    command: {
      resume: {
        type: "reject",
        request_id: "  request-1  ",
        tool_call_id: "  ",
        feedback: "  "
      }
    },
    modelId: "  "
  })

  assert.deepEqual(parsed, {
    threadId: "thread-1",
    command: {
      resume: {
        type: "reject",
        request_id: "request-1",
        tool_call_id: undefined,
        feedback: undefined
      }
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
