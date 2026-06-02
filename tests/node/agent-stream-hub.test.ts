import assert from "node:assert/strict"
import test from "node:test"
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

function createPendingApproval(id: string, toolCallId: string): ThreadHistoryState["pendingApproval"] {
  return {
    allowed_decisions: ["approve", "reject"],
    id,
    review: null,
    tool_call: {
      args: {
        command: "echo hello"
      },
      id: toolCallId,
      name: "bash",
      type: "tool_call"
    }
  }
}

function createHistory(overrides: Partial<ThreadHistoryState> = {}): ThreadHistoryState {
  return {
    artifacts: [],
    forkState: {
      canFork: true
    },
    messages: [],
    pendingApproval: null,
    todos: [],
    ...overrides
  }
}

test("AgentStreamHub hydrates history and fans out runtime event batches", async () => {
  const history = createHistory({
    messages: [createUserMessage("history-user", "hello")],
    todos: []
  })
  const hub = new AgentStreamHub(createThreadsService(history))
  const seenByFirst: string[][] = []
  const seenBySecond: string[][] = []

  await hub.subscribeThreadEvents("thread-1", "first", (batch) => {
    seenByFirst.push(batch.events.map((event) => event.type))
  })
  await hub.subscribeThreadEvents("thread-1", "second", (batch) => {
    seenBySecond.push(batch.events.map((event) => event.type))
  })

  const initial = await hub.getThreadSnapshot("thread-1")
  assert.deepEqual(initial.messagesPage, history.messages)
  assert.equal(initial.status, "idle")
  assert.equal(initial.revision, 1)

  await hub.prepareInvoke("thread-1", {
    content: "Ship it",
    id: "user-2"
  })

  const afterInvoke = await hub.getThreadSnapshot("thread-1")
  assert.equal(afterInvoke.status, "running")
  assert.equal(afterInvoke.messagesPage.at(-1)?.id, "user-2")
  assert.equal(afterInvoke.revision, 3)
  assert.deepEqual(afterInvoke.activeRun, {
    assistantMessageId: null,
    phase: "thinking",
    runId: null,
    status: "running",
    threadId: "thread-1",
    turnId: "user-2",
    userMessageId: "user-2"
  })
  assert.deepEqual(seenByFirst.at(-1), ["message.upserted", "run.started"])
  assert.deepEqual(seenBySecond.at(-1), ["message.upserted", "run.started"])

  await hub.handlePayload("thread-1", { type: "run_started", runId: "run-1" })
  const afterRunStarted = await hub.getThreadSnapshot("thread-1")
  assert.equal(afterRunStarted.revision, 4)
  assert.equal(afterRunStarted.activeRun?.runId, "run-1")
  assert.equal(afterRunStarted.activeRun?.turnId, "user-2")

  await hub.handlePayload("thread-1", { type: "cancelled" })

  const afterCancel = await hub.getThreadSnapshot("thread-1")
  assert.equal(afterCancel.revision, 5)
  assert.equal(afterCancel.latestRunId, "run-1")
  assert.equal(afterCancel.status, "cancelled")
  assert.equal(afterCancel.activeRun, null)
})

test("AgentStreamHub restores active run ownership for hydrated pending approvals", async () => {
  const history = createHistory({
    messages: [
      createUserMessage("user-1", "First question"),
      createAssistantMessage("assistant-1", "First answer"),
      createUserMessage("user-2", "Needs approval"),
      {
        content: "",
        created_at: new Date("2025-01-01T00:00:00.000Z"),
        id: "assistant-2",
        role: "assistant",
        tool_calls: [
          {
            args: {
              command: "echo hello"
            },
            id: "tool-1",
            name: "bash",
            type: "tool_call"
          }
        ]
      }
    ],
    pendingApproval: createPendingApproval("hitl:thread-1:run-1:tool-1", "tool-1")
  })
  const hub = new AgentStreamHub(createThreadsService(history))

  const snapshot = await hub.getThreadSnapshot("thread-1")

  assert.equal(snapshot.status, "interrupted")
  assert.equal(snapshot.revision, 1)
  assert.equal(snapshot.activeRun?.turnId, "user-2")
  assert.equal(snapshot.activeRun?.assistantMessageId, "assistant-2")
  assert.equal(snapshot.activeRun?.status, "waiting_approval")
  assert.equal(snapshot.activeRun?.phase, "waiting_tool_result")
})

test("AgentStreamHub global runtime subscribers receive every thread event batch", async () => {
  const hub = new AgentStreamHub(
    createThreadsService(
      createHistory({
        messages: [createUserMessage("history-user", "resume me")]
      })
    )
  )
  const seen: Array<{ status: string; threadId: string }> = []
  const unsubscribe = hub.subscribeAllThreadEvents("global", (batch) => {
    const hasRunStarted = batch.events.some(
      (event) => event.type === "run.started" || event.type === "run.resumed"
    )
    if (hasRunStarted) {
      seen.push({
        status: "running",
        threadId: batch.threadId
      })
    }
  })

  await hub.prepareInvoke("thread-1", {
    content: "Ship it",
    id: "user-1"
  })
  await hub.prepareResume("thread-2")
  unsubscribe()
  await hub.handlePayload("thread-1", { type: "run_started", runId: "run-1" })

  assert.deepEqual(seen, [
    { status: "running", threadId: "thread-1" },
    { status: "running", threadId: "thread-2" }
  ])
})

test("AgentStreamHub preserves pending approval while resume is waiting for service validation", async () => {
  const history = createHistory({
    messages: [
      createUserMessage("user-1", "Needs approval"),
      {
        content: "",
        created_at: new Date("2025-01-01T00:00:00.000Z"),
        id: "assistant-1",
        role: "assistant",
        tool_calls: [
          {
            args: {
              command: "echo hello"
            },
            id: "tool-1",
            name: "bash",
            type: "tool_call"
          }
        ]
      }
    ],
    pendingApproval: createPendingApproval("hitl:thread-1:run-1:tool-1", "tool-1")
  })
  const hub = new AgentStreamHub(createThreadsService(history))
  const eventTypes: string[] = []

  await hub.subscribeThreadEvents("thread-1", "events", (batch) => {
    eventTypes.push(...batch.events.map((event) => event.type))
  })
  await hub.prepareResume("thread-1")

  const afterPrepareResume = await hub.getThreadSnapshot("thread-1")
  assert.equal(afterPrepareResume.status, "running")
  assert.equal(afterPrepareResume.pendingApproval?.id, "hitl:thread-1:run-1:tool-1")
  assert.equal(afterPrepareResume.activeRun?.status, "running")
  assert.ok(eventTypes.includes("run.resumed"))

  await hub.handlePayload("thread-1", {
    code: "BAD_REQUEST",
    error: "Resume failed",
    message: "Resume failed",
    type: "error"
  })

  const afterFailedResume = await hub.getThreadSnapshot("thread-1")
  assert.equal(afterFailedResume.status, "error")
  assert.equal(afterFailedResume.pendingApproval?.id, "hitl:thread-1:run-1:tool-1")
})

test("AgentStreamHub clears pending approval only after resumed run starts", async () => {
  const history = createHistory({
    messages: [
      createUserMessage("user-1", "Needs approval"),
      createAssistantMessage("assistant-1", "")
    ],
    pendingApproval: createPendingApproval("hitl:thread-1:run-1:tool-1", "tool-1")
  })
  const hub = new AgentStreamHub(createThreadsService(history))
  const eventTypes: string[] = []

  await hub.subscribeThreadEvents("thread-1", "events", (batch) => {
    eventTypes.push(...batch.events.map((event) => event.type))
  })
  await hub.prepareResume("thread-1")

  const beforeRunStarted = await hub.getThreadSnapshot("thread-1")
  assert.equal(beforeRunStarted.pendingApproval?.id, "hitl:thread-1:run-1:tool-1")

  await hub.handlePayload("thread-1", { runId: "run-2", type: "run_started" })

  const afterRunStarted = await hub.getThreadSnapshot("thread-1")
  assert.equal(afterRunStarted.pendingApproval, null)
  assert.equal(afterRunStarted.activeRun?.runId, "run-2")
  assert.deepEqual(eventTypes, ["run.resumed", "message.upserted", "approval.cleared", "run.idAssigned"])
})

test("AgentStreamHub exposes runtime snapshots and event batches", async () => {
  const hub = new AgentStreamHub(createThreadsService(createHistory()))
  const eventTypes: string[] = []

  await hub.prepareInvoke("thread-events", {
    content: "Ship it",
    id: "user-1"
  })

  const snapshot = await hub.getThreadSnapshot("thread-events")
  assert.equal(snapshot.revision, 3)
  assert.equal(snapshot.activeRun?.turnId, "user-1")
  assert.deepEqual(
    snapshot.messagesPage.map((message) => message.id),
    ["user-1"]
  )

  await hub.subscribeThreadEvents("thread-events", "events", (batch) => {
    eventTypes.push(...batch.events.map((event) => event.type))
  })

  await hub.handlePayload("thread-events", { type: "run_started", runId: "run-1" })
  await hub.handlePayload("thread-events", {
    type: "stream",
    mode: "messages",
    data: [createSerializedAiMessage("assistant-1", "hello")]
  })

  assert.deepEqual(eventTypes, ["run.idAssigned", "message.upserted"])
})

test("AgentStreamHub does not replay hydration snapshots as runtime deltas", async () => {
  const hub = new AgentStreamHub(
    createThreadsService(
      createHistory({
        messages: [createUserMessage("history-user", "hello")]
      })
    )
  )
  const eventTypes: string[] = []

  const snapshot = await hub.getThreadSnapshot("hydrated-thread")
  assert.deepEqual(
    snapshot.messagesPage.map((message) => message.id),
    ["history-user"]
  )

  await hub.subscribeThreadEvents("hydrated-thread", "events", (batch) => {
    eventTypes.push(...batch.events.map((event) => event.type))
  })
  await hub.prepareInvoke("hydrated-thread", {
    content: "next",
    id: "user-2"
  })

  assert.deepEqual(eventTypes, ["message.upserted", "run.started"])
})

test("AgentStreamHub hydrates an empty thread only once", async () => {
  let loadCount = 0
  const hub = new AgentStreamHub({
    getHistory: async () => {
      loadCount += 1
      return createHistory()
    }
  } as unknown as ThreadsService)

  const firstSnapshot = await hub.getThreadSnapshot("empty-thread")
  const secondSnapshot = await hub.getThreadSnapshot("empty-thread")
  await hub.subscribeThreadEvents("empty-thread", "events", () => {})

  assert.equal(loadCount, 1)
  assert.equal(firstSnapshot.revision, 1)
  assert.equal(secondSnapshot.revision, 1)
})

test("AgentStreamHub derives persisted HITL request ids from run and tool call ids", async () => {
  const history = createHistory({
    messages: [createUserMessage("history-user", "hello")],
    todos: []
  })
  const hub = new AgentStreamHub(createThreadsService(history))
  const eventTypes: string[] = []

  await hub.subscribeThreadEvents("thread-2", "subscriber", (batch) => {
    eventTypes.push(...batch.events.map((event) => event.type))
  })

  await hub.prepareResume("thread-2")
  await hub.handlePayload("thread-2", { type: "run_started", runId: "run-2" })
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
                id: "langchain-action-id-is-not-the-request-id",
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

  const snapshot = await hub.getThreadSnapshot("thread-2")
  assert.equal(snapshot.status, "interrupted")
  assert.equal(snapshot.revision, 5)
  assert.equal(snapshot.activeRun?.status, "waiting_approval")
  assert.equal(snapshot.activeRun?.phase, "waiting_tool_result")
  assert.equal(snapshot.pendingApproval?.id, "hitl:thread-2:run-2:tool-1")
  assert.equal(snapshot.pendingApproval?.tool_call.id, "tool-1")
  assert.deepEqual(snapshot.todos, [
    {
      id: "todo-1",
      content: "Review command",
      status: "pending"
    }
  ])
  assert.ok(eventTypes.includes("approval.requested"))

  await hub.handlePayload("thread-2", { type: "done" })
  const afterDone = await hub.getThreadSnapshot("thread-2")
  assert.equal(afterDone.revision, 5)
  assert.equal(afterDone.status, "interrupted")
  assert.equal(afterDone.activeRun?.status, "waiting_approval")
})

test("AgentStreamHub merges partial values message snapshots without dropping prior turns", async () => {
  const history = createHistory({
    messages: [
      createUserMessage("user-1", "hello"),
      createAssistantMessage("assistant-1", "hi there")
    ],
    todos: []
  })
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

  const snapshot = await hub.getThreadSnapshot("thread-3")
  assert.equal(snapshot.revision, 5)
  assert.deepEqual(
    snapshot.messagesPage.map((message) => ({ id: message.id, role: message.role })),
    [
      { id: "user-1", role: "user" },
      { id: "assistant-1", role: "assistant" },
      { id: "user-2", role: "user" },
      { id: "assistant-2", role: "assistant" }
    ]
  )
  assert.equal(snapshot.activeRun?.turnId, "user-2")
  assert.equal(snapshot.activeRun?.assistantMessageId, "assistant-2")
  assert.equal(snapshot.activeRun?.phase, "streaming")
})

test("AgentStreamHub emits only scoped runtime events during token streaming", async () => {
  const hub = new AgentStreamHub(createThreadsService(createHistory()))
  const runtimeEventTypes: string[] = []

  await hub.subscribeThreadEvents("thread-4", "runtime-subscriber", (batch) => {
    runtimeEventTypes.push(...batch.events.map((event) => event.type))
  })

  await hub.prepareInvoke("thread-4", {
    content: "stream please",
    id: "user-1"
  })

  await hub.handlePayload("thread-4", {
    type: "stream",
    mode: "messages",
    data: [createSerializedAiMessage("assistant-1", "hello")]
  })
  await hub.handlePayload("thread-4", {
    type: "stream",
    mode: "messages",
    data: [createSerializedAiMessage("assistant-1", " again")]
  })

  const snapshot = await hub.getThreadSnapshot("thread-4")
  assert.equal(snapshot.revision, 5)
  assert.equal(snapshot.messagesPage.at(-1)?.content, "hello again")
  assert.deepEqual(runtimeEventTypes, [
    "message.upserted",
    "run.started",
    "message.upserted",
    "message.part.delta"
  ])
})

test("AgentStreamHub ignores empty assistant token chunks without advancing runtime revision", async () => {
  const hub = new AgentStreamHub(createThreadsService(createHistory()))
  const runtimeEventTypes: string[] = []

  await hub.subscribeThreadEvents("thread-empty-token", "runtime-subscriber", (batch) => {
    runtimeEventTypes.push(...batch.events.map((event) => event.type))
  })

  await hub.prepareInvoke("thread-empty-token", {
    content: "stream please",
    id: "user-1"
  })
  await hub.handlePayload("thread-empty-token", {
    data: [createSerializedAiMessage("assistant-1", "hello")],
    mode: "messages",
    type: "stream"
  })
  const beforeEmptyChunk = await hub.getThreadSnapshot("thread-empty-token")

  await hub.handlePayload("thread-empty-token", {
    data: [createSerializedAiMessage("assistant-1", "")],
    mode: "messages",
    type: "stream"
  })

  const afterEmptyChunk = await hub.getThreadSnapshot("thread-empty-token")
  assert.equal(afterEmptyChunk.revision, beforeEmptyChunk.revision)
  assert.equal(afterEmptyChunk.messagesPage.at(-1)?.content, "hello")
  assert.deepEqual(runtimeEventTypes, [
    "message.upserted",
    "run.started",
    "message.upserted"
  ])
})

test("AgentStreamHub hides provider-emitted tool call markup from assistant text", async () => {
  const history = createHistory({
    messages: [],
    todos: []
  })
  const hub = new AgentStreamHub(createThreadsService(history))

  await hub.handlePayload("thread-4", {
    type: "stream",
    mode: "messages",
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content:
            "<function=ext__appleReminders__createReminder> <parameter=title> 本周内整理书桌 <parameter=notes> 清理不需要的文件和物品 </tool_call>",
          id: "assistant-tool-call",
          tool_calls: [
            {
              args: {
                notes: "清理不需要的文件和物品",
                title: "本周内整理书桌"
              },
              id: "tool-call-1",
              name: "ext__appleReminders__createReminder",
              type: "tool_call"
            }
          ]
        },
        type: "ai" as const
      },
      {}
    ]
  })

  const snapshot = await hub.getThreadSnapshot("thread-4")
  const message = snapshot.messagesPage.at(-1)
  assert.equal(message?.id, "assistant-tool-call")
  assert.equal(message?.content, "")
  assert.equal(message?.tool_calls?.[0]?.name, "ext__appleReminders__createReminder")
})

test("AgentStreamHub hides provider-emitted tool call markup when hydrating history", async () => {
  const history = createHistory({
    messages: [
      {
        content:
          "<function=ext__appleReminders__createReminder> <parameter=title> 周末去超市采购 </tool_call>",
        created_at: new Date("2025-01-01T00:00:00.000Z"),
        id: "assistant-history-tool-call",
        role: "assistant",
        tool_calls: [
          {
            args: {
              title: "周末去超市采购"
            },
            id: "tool-call-history",
            name: "ext__appleReminders__createReminder",
            type: "tool_call"
          }
        ]
      }
    ],
    todos: []
  })
  const hub = new AgentStreamHub(createThreadsService(history))

  const snapshot = await hub.getThreadSnapshot("thread-5")
  assert.equal(snapshot.messagesPage[0]?.content, "")
  assert.equal(
    snapshot.messagesPage[0]?.tool_calls?.[0]?.name,
    "ext__appleReminders__createReminder"
  )
})

test("AgentStreamHub appends streamed reasoning and text content blocks", async () => {
  const history = createHistory({
    messages: [createUserMessage("user-1", "think out loud")],
    todos: []
  })
  const hub = new AgentStreamHub(createThreadsService(history))

  await hub.handlePayload("thread-6", {
    type: "stream",
    mode: "messages",
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content: [
            {
              thinking: "First, ",
              type: "thinking"
            }
          ],
          id: "assistant-1"
        }
      },
      {}
    ]
  })
  await hub.handlePayload("thread-6", {
    type: "stream",
    mode: "messages",
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content: [
            {
              thinking: "inspect context.",
              type: "thinking"
            }
          ],
          id: "assistant-1"
        }
      },
      {}
    ]
  })
  await hub.handlePayload("thread-6", {
    type: "stream",
    mode: "messages",
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content: [
            {
              text: "Here is the result.",
              type: "text"
            }
          ],
          id: "assistant-1"
        }
      },
      {}
    ]
  })

  const snapshot = await hub.getThreadSnapshot("thread-6")
  assert.deepEqual(snapshot.messagesPage.at(-1)?.content, [
    {
      reasoning: "First, inspect context.",
      type: "reasoning"
    },
    {
      text: "Here is the result.",
      type: "text"
    }
  ])
})
