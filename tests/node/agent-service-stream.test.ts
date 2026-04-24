import assert from "node:assert/strict"
import test from "node:test"

async function loadAgentServiceApi(): Promise<{
  projectInterruptForIpc: (
    threadId: string,
    runId: string,
    data: unknown
  ) => unknown[] | undefined
  serializeStreamChunkForIpc: (
    mode: string,
    data: unknown,
    options?: {
      runId?: string
      threadId?: string
    }
  ) => unknown
}> {
  const module = await import("../../src/main/agent/service")
  const api = (module.default ?? module) as {
    projectInterruptForIpc: (
      threadId: string,
      runId: string,
      data: unknown
    ) => unknown[] | undefined
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

test("projectInterruptForIpc rewrites interrupt action id to the canonical HITL request id", async () => {
  const { projectInterruptForIpc } = await loadAgentServiceApi()
  const projectedInterrupt = projectInterruptForIpc("thread-1", "run-1", {
    __interrupt__: [
      {
        value: {
          actionRequests: [
            {
              id: "tool-call-1",
              toolCallId: "tool-call-1",
              name: "write_file",
              args: {
                path: "/tmp/demo.txt",
                content: "hello"
              }
            }
          ],
          reviewConfigs: [
            {
              actionName: "write_file",
              allowedDecisions: ["approve", "reject"]
            }
          ]
        }
      }
    ]
  })

  assert.deepEqual(projectedInterrupt, [
    {
      value: {
        actionRequests: [
          {
            id: "hitl:thread-1:run-1:tool-call-1",
            toolCallId: "tool-call-1",
            name: "write_file",
            args: {
              path: "/tmp/demo.txt",
              content: "hello"
            }
          }
        ],
        reviewConfigs: [
          {
            actionName: "write_file",
            allowedDecisions: ["approve", "reject"]
          }
        ]
      }
    }
  ])
})

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
