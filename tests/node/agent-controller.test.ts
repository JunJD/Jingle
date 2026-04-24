import assert from "node:assert/strict"
import test from "node:test"
import { startAgentStreamOperation } from "../../src/main/agent/stream-operation"
import { OpenworkIpcError } from "../../src/main/ipc/error"
import type { AgentStreamPayload, AgentStreamSink } from "../../src/main/agent/service"

function createTestSink(collected: AgentStreamPayload[]): AgentStreamSink {
  return {
    onClosed: () => () => {},
    send: (payload) => {
      collected.push(payload)
    }
  }
}

test("startAgentStreamOperation converts rejected resume promises into stream errors", async () => {
  const payloads: AgentStreamPayload[] = []
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    startAgentStreamOperation(
      "resume",
      createTestSink(payloads),
      Promise.reject(
        new OpenworkIpcError({
          channel: "agent:resume",
          code: "NOT_FOUND",
          message: '[Agent] HITL request "tool-1" not found.'
        })
      )
    )

    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    console.error = originalConsoleError
  }

  assert.deepEqual(payloads, [
    {
      channel: "agent:resume",
      code: "NOT_FOUND",
      error: '[Agent] HITL request "tool-1" not found.',
      message: '[Agent] HITL request "tool-1" not found.',
      status: 404,
      type: "error"
    }
  ])
})

test("startAgentStreamOperation keeps fulfilled invoke promises silent", async () => {
  const payloads: AgentStreamPayload[] = []

  startAgentStreamOperation("invoke", createTestSink(payloads), Promise.resolve())
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(payloads, [])
})
