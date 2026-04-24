import assert from "node:assert/strict"
import test from "node:test"
import { EventType } from "@ag-ui/core"
import type { Message, ThreadHistoryState } from "../../src/shared/app-types"
import { AgentStreamHub } from "../../src/main/agent/stream-hub"
import type { ThreadsService } from "../../src/main/threads/service"

function createThreadsService(history: ThreadHistoryState): ThreadsService {
  return {
    getHistory: async () => history
  } as unknown as ThreadsService
}

function createUserMessage(id: string, content: string): Message {
  return {
    content,
    created_at: new Date("2025-01-01T00:00:00.000Z"),
    id,
    role: "user"
  }
}

function createAssistantMessage(id: string, content: string): Message {
  return {
    content,
    created_at: new Date("2025-01-01T00:00:00.000Z"),
    id,
    role: "assistant"
  }
}

function createSerializedAiMessage(id: string, content: string) {
  return {
    id: ["AIMessage"],
    kwargs: {
      content,
      id
    },
    type: "ai" as const
  }
}

test("AgentStreamHub hydrates history and fans out projection updates", async () => {
  const history: ThreadHistoryState = {
    artifacts: [],
    messages: [createUserMessage("history-user", "hello")],
    pendingApproval: null,
    todos: []
  }
  const hub = new AgentStreamHub(createThreadsService(history))
  const seenByFirst: string[] = []
  const seenBySecond: string[] = []

  await hub.subscribe("thread-1", "first", (envelope) => {
    seenByFirst.push(envelope.projection.status)
  })
  await hub.subscribe("thread-1", "second", (envelope) => {
    seenBySecond.push(envelope.projection.status)
  })

  const initial = await hub.getProjectionEnvelope("thread-1")
  assert.deepEqual(initial.projection.messages, history.messages)
  assert.equal(initial.projection.status, "idle")

  await hub.prepareInvoke("thread-1", {
    content: "Ship it",
    id: "user-2"
  })

  const afterInvoke = await hub.getProjectionEnvelope("thread-1")
  assert.equal(afterInvoke.event, null)
  assert.equal(afterInvoke.projection.isLoading, true)
  assert.equal(afterInvoke.projection.messages.at(-1)?.id, "user-2")
  assert.equal(seenByFirst.at(-1), "running")
  assert.equal(seenBySecond.at(-1), "running")

  await hub.handlePayload("thread-1", { type: "run_started", runId: "run-1" })
  await hub.handlePayload("thread-1", { type: "cancelled" })

  const afterCancel = await hub.getProjectionEnvelope("thread-1")
  assert.equal(afterCancel.projection.runId, "run-1")
  assert.equal(afterCancel.projection.isLoading, false)
  assert.equal(afterCancel.projection.status, "cancelled")
})

test("AgentStreamHub converts values payloads into interrupted projection snapshots", async () => {
  const history: ThreadHistoryState = {
    artifacts: [],
    messages: [createUserMessage("history-user", "hello")],
    pendingApproval: null,
    todos: []
  }
  const hub = new AgentStreamHub(createThreadsService(history))
  const events: string[] = []

  await hub.subscribe("thread-2", "subscriber", (envelope) => {
    if (envelope.event) {
      events.push(envelope.event.type)
    }
  })

  await hub.prepareResume("thread-2")
  await hub.handlePayload("thread-2", {
    type: "stream",
    mode: "values",
    data: {
      __interrupt__: [
        {
          value: {
            actionRequests: [
              {
                args: { command: "echo hello" },
                id: "request-1",
                name: "bash",
                toolCallId: "tool-1"
              }
            ],
            reviewConfigs: [
              {
                actionName: "bash",
                allowedDecisions: ["approve", "reject"]
              }
            ]
          }
        }
      ],
      todos: [
        {
          id: "todo-1",
          content: "Review command",
          status: "pending"
        }
      ]
    }
  })

  const envelope = await hub.getProjectionEnvelope("thread-2")
  assert.equal(envelope.projection.isLoading, false)
  assert.equal(envelope.projection.status, "interrupted")
  assert.equal(envelope.projection.pendingApproval?.id, "request-1")
  assert.equal(envelope.projection.pendingApproval?.tool_call.id, "tool-1")
  assert.deepEqual(envelope.projection.todos, [
    {
      id: "todo-1",
      content: "Review command",
      status: "pending"
    }
  ])
  assert.ok(events.includes(EventType.STATE_SNAPSHOT))
})

test("AgentStreamHub merges partial values message snapshots without dropping prior turns", async () => {
  const history: ThreadHistoryState = {
    artifacts: [],
    messages: [
      createUserMessage("user-1", "hello"),
      createAssistantMessage("assistant-1", "hi there")
    ],
    pendingApproval: null,
    todos: []
  }
  const hub = new AgentStreamHub(createThreadsService(history))

  await hub.prepareInvoke("thread-3", {
    content: "second turn",
    id: "user-2"
  })
  await hub.handlePayload("thread-3", {
    type: "stream",
    mode: "values",
    data: {
      messages: [createSerializedAiMessage("assistant-2", "second answer")]
    }
  })

  const envelope = await hub.getProjectionEnvelope("thread-3")
  assert.deepEqual(
    envelope.projection.messages.map((message) => ({ id: message.id, role: message.role })),
    [
      { id: "user-1", role: "user" },
      { id: "assistant-1", role: "assistant" },
      { id: "user-2", role: "user" },
      { id: "assistant-2", role: "assistant" }
    ]
  )
})
