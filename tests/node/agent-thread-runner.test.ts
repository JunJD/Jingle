import assert from "node:assert/strict"
import test from "node:test"
import type { AgentThreadDataSnapshot, Message } from "../../src/shared/app-types"
import type { HITLRequest } from "../../src/shared/hitl"
import { AgentThreadRunner } from "../../src/main/agent/agent-thread-runner"
import type { ThreadsService } from "../../src/main/threads/service"

function createThreadsService(threadData: AgentThreadDataSnapshot): ThreadsService {
  return {
    getAgentThreadData: async () => threadData,
    getPersistedAgentThreadData: async () => threadData
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

function createPendingApproval(
  id: string,
  toolCallId: string
): HITLRequest {
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

function createThreadData(
  input: {
    messages?: Message[]
    pendingApproval?: HITLRequest | null
    todos?: AgentThreadDataSnapshot["runState"]["todos"]
  } = {}
): AgentThreadDataSnapshot {
  const pendingApproval = input.pendingApproval ?? null
  return {
    thread: {
      metadata: undefined,
      status: pendingApproval ? "interrupted" : "idle",
      thread_id: "thread-1",
      title: undefined
    },
    messages: {
      artifacts: [],
      messages: input.messages ?? []
    },
    runState: {
      error: null,
      forkState: {
        canFork: true
      },
      pendingApproval,
      runId: null,
      todos: input.todos ?? []
    }
  }
}

test("AgentThreadRunner hydrates history and fans out runtime event batches", async () => {
  const history = createThreadData({
    messages: [createUserMessage("history-user", "hello")],
    todos: []
  })
  const hub = new AgentThreadRunner(createThreadsService(history))
  const seenByFirst: string[][] = []
  const seenBySecond: string[][] = []

  await hub.connectThreadEvents("thread-1", "first", (batch) => {
    seenByFirst.push(batch.events.map((event) => event.type))
  })
  await hub.connectThreadEvents("thread-1", "second", (batch) => {
    seenBySecond.push(batch.events.map((event) => event.type))
  })

  const initial = await hub.readThreadState("thread-1")
  assert.deepEqual(initial.messagesPage, history.messages.messages)
  assert.equal(initial.status, "idle")
  assert.equal(initial.revision, 0)

  await hub.prepareInvoke("thread-1", {
    content: "Ship it",
    id: "user-2"
  })

  const afterInvoke = await hub.readThreadState("thread-1")
  assert.equal(afterInvoke.status, "running")
  assert.equal(afterInvoke.messagesPage.at(-1)?.id, "user-2")
  assert.equal(afterInvoke.revision, 2)
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
  const afterRunStarted = await hub.readThreadState("thread-1")
  assert.equal(afterRunStarted.revision, 3)
  assert.equal(afterRunStarted.activeRun?.runId, "run-1")
  assert.equal(afterRunStarted.activeRun?.turnId, "user-2")

  await hub.handlePayload("thread-1", { type: "cancelled" })

  const afterCancel = await hub.readThreadState("thread-1")
  assert.equal(afterCancel.revision, 4)
  assert.equal(afterCancel.latestRunId, "run-1")
  assert.equal(afterCancel.status, "cancelled")
  assert.equal(afterCancel.activeRun, null)
})

test("AgentThreadRunner restores active run ownership for hydrated pending approvals", async () => {
  const history = createThreadData({
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
  const hub = new AgentThreadRunner(createThreadsService(history))

  const snapshot = await hub.readThreadState("thread-1")

  assert.equal(snapshot.status, "interrupted")
  assert.equal(snapshot.revision, 0)
  assert.equal(snapshot.activeRun?.turnId, "user-2")
  assert.equal(snapshot.activeRun?.assistantMessageId, "assistant-2")
  assert.equal(snapshot.activeRun?.status, "waiting_approval")
  assert.equal(snapshot.activeRun?.phase, "waiting_tool_result")
})

test("AgentThreadRunner global runtime subscribers receive every thread event batch", async () => {
  const hub = new AgentThreadRunner(
    createThreadsService(
      createThreadData({
        messages: [createUserMessage("history-user", "resume me")]
      })
    )
  )
  const seen: Array<{ status: string; threadId: string }> = []
  const unsubscribe = hub.connectAllThreadEvents("global", (batch) => {
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

test("AgentThreadRunner preserves pending approval while resume is waiting for service validation", async () => {
  const history = createThreadData({
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
  const hub = new AgentThreadRunner(createThreadsService(history))
  const eventTypes: string[] = []

  await hub.connectThreadEvents("thread-1", "events", (batch) => {
    eventTypes.push(...batch.events.map((event) => event.type))
  })
  await hub.prepareResume("thread-1")

  const afterPrepareResume = await hub.readThreadState("thread-1")
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

  const afterFailedResume = await hub.readThreadState("thread-1")
  assert.equal(afterFailedResume.status, "error")
  assert.equal(afterFailedResume.pendingApproval?.id, "hitl:thread-1:run-1:tool-1")
})

test("AgentThreadRunner clears pending approval only after resumed run starts", async () => {
  const history = createThreadData({
    messages: [
      createUserMessage("user-1", "Needs approval"),
      createAssistantMessage("assistant-1", "")
    ],
    pendingApproval: createPendingApproval("hitl:thread-1:run-1:tool-1", "tool-1")
  })
  const hub = new AgentThreadRunner(createThreadsService(history))
  const eventTypes: string[] = []

  await hub.connectThreadEvents("thread-1", "events", (batch) => {
    eventTypes.push(...batch.events.map((event) => event.type))
  })
  await hub.prepareResume("thread-1")

  const beforeRunStarted = await hub.readThreadState("thread-1")
  assert.equal(beforeRunStarted.pendingApproval?.id, "hitl:thread-1:run-1:tool-1")

  await hub.handlePayload("thread-1", { runId: "run-2", type: "run_started" })

  const afterRunStarted = await hub.readThreadState("thread-1")
  assert.equal(afterRunStarted.pendingApproval, null)
  assert.equal(afterRunStarted.activeRun?.runId, "run-2")
  assert.deepEqual(eventTypes, [
    "run.resumed",
    "message.upserted",
    "approval.cleared",
    "run.idAssigned"
  ])
})

test("AgentThreadRunner exposes runtime state and event batches", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))
  const eventTypes: string[] = []

  await hub.prepareInvoke("thread-events", {
    content: "Ship it",
    id: "user-1"
  })

  const snapshot = await hub.readThreadState("thread-events")
  assert.equal(snapshot.revision, 2)
  assert.equal(snapshot.activeRun?.turnId, "user-1")
  assert.deepEqual(
    snapshot.messagesPage.map((message) => message.id),
    ["user-1"]
  )

  await hub.connectThreadEvents("thread-events", "events", (batch) => {
    eventTypes.push(...batch.events.map((event) => event.type))
  })

  await hub.handlePayload("thread-events", { type: "run_started", runId: "run-1" })
  await hub.handlePayload("thread-events", {
    type: "stream",
    mode: "messages",
    data: [createSerializedAiMessage("assistant-1", "hello")]
  })

  assert.deepEqual(eventTypes, [
    "message.upserted",
    "run.started",
    "run.idAssigned",
    "message.upserted"
  ])
})

test("AgentThreadRunner does not replay hydration snapshots as runtime deltas", async () => {
  const hub = new AgentThreadRunner(
    createThreadsService(
      createThreadData({
        messages: [createUserMessage("history-user", "hello")]
      })
    )
  )
  const eventTypes: string[] = []

  const snapshot = await hub.readThreadState("hydrated-thread")
  assert.deepEqual(
    snapshot.messagesPage.map((message) => message.id),
    ["history-user"]
  )

  await hub.connectThreadEvents("hydrated-thread", "events", (batch) => {
    eventTypes.push(...batch.events.map((event) => event.type))
  })
  await hub.prepareInvoke("hydrated-thread", {
    content: "next",
    id: "user-2"
  })

  assert.deepEqual(eventTypes, ["message.upserted", "run.started"])
})

test("AgentThreadRunner hydrates an empty thread only once", async () => {
  let loadCount = 0
  const hub = new AgentThreadRunner({
    getPersistedAgentThreadData: async () => {
      loadCount += 1
      return {
        thread: {
          metadata: undefined,
          status: "idle",
          thread_id: "empty-thread",
          title: undefined
        },
        messages: {
          artifacts: [],
          messages: []
        },
        runState: {
          error: null,
          forkState: { canFork: true },
          pendingApproval: null,
          runId: null,
          todos: []
        }
      } satisfies AgentThreadDataSnapshot
    },
    getAgentThreadData: async () => {
      loadCount += 1
      return {
        thread: {
          metadata: undefined,
          status: "idle",
          thread_id: "empty-thread",
          title: undefined
        },
        messages: {
          artifacts: [],
          messages: []
        },
        runState: {
          error: null,
          forkState: { canFork: true },
          pendingApproval: null,
          runId: null,
          todos: []
        }
      } satisfies AgentThreadDataSnapshot
    }
  } as unknown as ThreadsService)

  const firstSnapshot = await hub.readThreadState("empty-thread")
  const secondSnapshot = await hub.readThreadState("empty-thread")
  await hub.connectThreadEvents("empty-thread", "events", () => {})

  assert.equal(loadCount, 1)
  assert.equal(firstSnapshot.revision, 0)
  assert.equal(secondSnapshot.revision, 0)
})

test("AgentThreadRunner derives persisted HITL request ids from run and tool call ids", async () => {
  const history = createThreadData({
    messages: [createUserMessage("history-user", "hello")],
    todos: []
  })
  const hub = new AgentThreadRunner(createThreadsService(history))
  const eventTypes: string[] = []

  await hub.connectThreadEvents("thread-2", "subscriber", (batch) => {
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

  const snapshot = await hub.readThreadState("thread-2")
  assert.equal(snapshot.status, "interrupted")
  assert.equal(snapshot.revision, 4)
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
  const afterDone = await hub.readThreadState("thread-2")
  assert.equal(afterDone.revision, 4)
  assert.equal(afterDone.status, "interrupted")
  assert.equal(afterDone.activeRun?.status, "waiting_approval")
})

test("AgentThreadRunner ignores values message snapshots without mutating visible turns", async () => {
  const history = createThreadData({
    messages: [
      createUserMessage("user-1", "hello"),
      createAssistantMessage("assistant-1", "hi there")
    ],
    todos: []
  })
  const hub = new AgentThreadRunner(createThreadsService(history))
  const eventTypes: string[] = []

  await hub.connectThreadEvents("thread-3", "events", (batch) => {
    eventTypes.push(...batch.events.map((event) => event.type))
  })

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

  const snapshot = await hub.readThreadState("thread-3")
  assert.equal(snapshot.revision, 2)
  assert.deepEqual(
    snapshot.messagesPage.map((message) => ({ id: message.id, role: message.role })),
    [
      { id: "user-1", role: "user" },
      { id: "assistant-1", role: "assistant" },
      { id: "user-2", role: "user" }
    ]
  )
  assert.equal(snapshot.activeRun?.turnId, "user-2")
  assert.equal(snapshot.activeRun?.assistantMessageId, null)
  assert.equal(snapshot.activeRun?.phase, "thinking")
  assert.deepEqual(eventTypes, ["message.upserted", "run.started"])
})

test("AgentThreadRunner values message snapshots do not append stale turns", async () => {
  const history = createThreadData({
    messages: [
      createUserMessage("user-1", "First question"),
      createAssistantMessage("assistant-1", "First answer")
    ],
    todos: []
  })
  const hub = new AgentThreadRunner(createThreadsService(history))

  await hub.prepareInvoke("thread-values-order", {
    content: "Second question",
    id: "user-2"
  })
  await hub.handlePayload("thread-values-order", {
    data: {
      messages: [
        {
          id: ["HumanMessage"],
          kwargs: {
            content: "First question",
            id: "user-1"
          },
          type: "human" as const
        },
        {
          id: ["HumanMessage"],
          kwargs: {
            content: "Second question",
            id: "user-2"
          },
          type: "human" as const
        },
        createSerializedAiMessage("assistant-1", "First answer"),
        createSerializedAiMessage("assistant-2", "Second answer")
      ]
    },
    mode: "values",
    type: "stream"
  })

  const snapshot = await hub.readThreadState("thread-values-order")
  assert.deepEqual(
    snapshot.messagesPage.map((message) => ({ id: message.id, role: message.role })),
    [
      { id: "user-1", role: "user" },
      { id: "assistant-1", role: "assistant" },
      { id: "user-2", role: "user" }
    ]
  )
  assert.equal(snapshot.activeRun?.turnId, "user-2")
  assert.equal(snapshot.activeRun?.assistantMessageId, null)
})

test("AgentThreadRunner ignores values message snapshots after streamed assistant text", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))

  await hub.prepareInvoke("thread-values-stream-id", {
    content: "stream please",
    id: "user-1"
  })
  await hub.handlePayload("thread-values-stream-id", {
    data: [createSerializedAiMessage("streamed-assistant", "hel")],
    mode: "messages",
    type: "stream"
  })
  await hub.handlePayload("thread-values-stream-id", {
    data: {
      messages: [createSerializedAiMessage("values-assistant", "hello")]
    },
    mode: "values",
    type: "stream"
  })

  const snapshot = await hub.readThreadState("thread-values-stream-id")
  const assistantMessages = snapshot.messagesPage.filter((message) => message.role === "assistant")

  assert.equal(assistantMessages.length, 1)
  assert.equal(assistantMessages[0]?.id, "streamed-assistant")
  assert.equal(assistantMessages[0]?.content, "hel")
  assert.equal(snapshot.activeRun?.assistantMessageId, "streamed-assistant")
})

test("AgentThreadRunner exposes runtime messages as a thread data overlay", async () => {
  const persistedThreadData = createThreadData()
  const hub = new AgentThreadRunner(createThreadsService(persistedThreadData))

  await hub.prepareInvoke("thread-overlay", {
    content: "bdd:success",
    id: "user-1"
  })
  await hub.handlePayload("thread-overlay", {
    runId: "run-1",
    type: "run_started"
  })
  await hub.handlePayload("thread-overlay", {
    data: [createSerializedAiMessage("assistant-1", "scripted agent completed")],
    mode: "messages",
    type: "stream"
  })
  await hub.handlePayload("thread-overlay", {
    type: "done"
  })

  const overlay = hub.readThreadDataOverlay("thread-overlay", persistedThreadData)

  assert.equal(overlay?.thread.status, "idle")
  assert.deepEqual(
    overlay?.messages.messages.map((message) => ({ id: message.id, role: message.role })),
    [
      { id: "user-1", role: "user" },
      { id: "assistant-1", role: "assistant" }
    ]
  )
  assert.equal(overlay?.runState.runId, "run-1")
})

test("AgentThreadRunner emits only scoped runtime events during token streaming", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))
  const runtimeEventTypes: string[] = []

  await hub.connectThreadEvents("thread-4", "runtime-subscriber", (batch) => {
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

  const snapshot = await hub.readThreadState("thread-4")
  assert.equal(snapshot.revision, 4)
  assert.equal(snapshot.messagesPage.at(-1)?.content, "hello again")
  assert.deepEqual(runtimeEventTypes, [
    "message.upserted",
    "run.started",
    "message.upserted",
    "message.part.delta"
  ])
})

test("AgentThreadRunner ignores empty assistant token chunks without advancing runtime revision", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))
  const runtimeEventTypes: string[] = []

  await hub.connectThreadEvents("thread-empty-token", "runtime-subscriber", (batch) => {
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
  const beforeEmptyChunk = await hub.readThreadState("thread-empty-token")

  await hub.handlePayload("thread-empty-token", {
    data: [createSerializedAiMessage("assistant-1", "")],
    mode: "messages",
    type: "stream"
  })

  const afterEmptyChunk = await hub.readThreadState("thread-empty-token")
  assert.equal(afterEmptyChunk.revision, beforeEmptyChunk.revision)
  assert.equal(afterEmptyChunk.messagesPage.at(-1)?.content, "hello")
  assert.deepEqual(runtimeEventTypes, ["message.upserted", "run.started", "message.upserted"])
})

test("AgentThreadRunner hides provider-emitted tool call markup from assistant text", async () => {
  const history = createThreadData({
    messages: [],
    todos: []
  })
  const hub = new AgentThreadRunner(createThreadsService(history))

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

  const snapshot = await hub.readThreadState("thread-4")
  const message = snapshot.messagesPage.at(-1)
  assert.equal(message?.id, "assistant-tool-call")
  assert.equal(message?.content, "")
  assert.equal(message?.tool_calls?.[0]?.name, "ext__appleReminders__createReminder")
})

test("AgentThreadRunner hides provider-emitted tool call markup when hydrating history", async () => {
  const history = createThreadData({
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
  const hub = new AgentThreadRunner(createThreadsService(history))

  const snapshot = await hub.readThreadState("thread-5")
  assert.equal(snapshot.messagesPage[0]?.content, "")
  assert.equal(
    snapshot.messagesPage[0]?.tool_calls?.[0]?.name,
    "ext__appleReminders__createReminder"
  )
})

test("AgentThreadRunner appends streamed reasoning and text content blocks", async () => {
  const history = createThreadData({
    messages: [createUserMessage("user-1", "think out loud")],
    todos: []
  })
  const hub = new AgentThreadRunner(createThreadsService(history))

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

  const snapshot = await hub.readThreadState("thread-6")
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
