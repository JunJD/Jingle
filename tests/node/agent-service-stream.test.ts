import assert from "node:assert/strict"
import test from "node:test"

async function loadAgentServiceApi(): Promise<{
  serializeStreamChunkForIpc: (
    mode: string,
    data: unknown,
    options?: {
      runId?: string
      threadId?: string
    }
  ) => unknown
}> {
  const api = (await import("../../src/main/agent/service")) as {
    serializeStreamChunkForIpc: (
      mode: string,
      data: unknown,
      options?: {
        runId?: string
        threadId?: string
      }
    ) => unknown
  }

  return api
}

test("serializeStreamChunkForIpc keeps projected values interrupt ids aligned with runtime state", async () => {
  const { serializeStreamChunkForIpc } = await loadAgentServiceApi()
  const projected = serializeStreamChunkForIpc(
    "values",
    {
      __interrupt__: [
        {
          value: {
            actionRequests: [
              {
                id: "tool-call-1",
                toolCallId: "tool-call-1",
                name: "write_file",
                args: {
                  path: "/tmp/demo.txt"
                }
              }
            ]
          }
        }
      ],
      todos: []
    },
    {
      threadId: "thread-1",
      runId: "run-1"
    }
  ) as {
    __interrupt__?: Array<{
      value?: {
        actionRequests?: Array<{
          id?: string
        }>
      }
    }>
  }

  assert.equal(
    projected.__interrupt__?.[0]?.value?.actionRequests?.[0]?.id,
    "hitl:thread-1:run-1:tool-call-1"
  )
})
