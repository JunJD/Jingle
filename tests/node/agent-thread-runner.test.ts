import assert from "node:assert/strict"
import test from "node:test"
import { AIMessageChunk } from "@langchain/core/messages"
import type { AgentThreadDataSnapshot, Message } from "../../src/shared/app-types"
import type { HITLRequest } from "../../src/shared/hitl"
import { AgentThreadRunner } from "../../src/main/agent/agent-thread-runner"
import type { ThreadsService } from "../../src/main/threads/service"
import { readFileMutationResultMetadata } from "../../src/shared/file-mutation-result"
import {
  JINGLE_TOOL_EXECUTION_METADATA_KEY,
  readJingleToolExecutionTiming
} from "@jingle/agent-client"
import {
  readJingleSteeringAppliedMarker,
  readJingleSteeringStatus
} from "../../src/shared/message-steering"

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

function createLiveLangChainAiMessageChunk(id: string, content: string) {
  return structuredClone(new AIMessageChunk({ content, id }))
}

function createPendingApproval(id: string, toolCallId: string): HITLRequest {
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
      contextInclusions: [],
      error: null,
      forkState: {
        canFork: true
      },
      pendingApproval,
      runId: null,
      todos: input.todos ?? [],
      workspacePath: null
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
  assert.equal(afterInvoke.activeRun?.startedAt instanceof Date, true)
  assert.equal(afterInvoke.activeRun?.phaseStartedAt, afterInvoke.activeRun?.startedAt)
  assert.deepEqual(afterInvoke.activeRun, {
    assistantMessageId: null,
    currentToolCallId: null,
    phase: "thinking",
    phaseStartedAt: afterInvoke.activeRun?.phaseStartedAt,
    runId: null,
    startedAt: afterInvoke.activeRun?.startedAt,
    status: "running",
    threadId: "thread-1",
    toolCalls: [],
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

test("AgentThreadRunner projects retrieved context inclusions from values stream state", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))

  await hub.prepareInvoke("thread-1", {
    content: "Find old context",
    id: "user-1"
  })
  await hub.handlePayload("thread-1", {
    runId: "run-1",
    type: "run_started"
  })
  await hub.handlePayload("thread-1", {
    data: {
      contextInclusions: [
        {
          availability: "available",
          createdAt: 123,
          id: "ctx:run-1:retrieved:history_message:thread-1:message-1",
          messageId: null,
          mode: "retrieved",
          preview: "Recovered old message",
          runId: "run-1",
          sourceId: "message-1",
          sourceType: "history_message",
          target: {
            messageId: "message-1",
            threadId: "thread-1",
            type: "history_message"
          },
          threadId: "thread-1",
          title: "assistant message",
          turnId: null
        }
      ]
    },
    mode: "values",
    type: "stream"
  })

  const state = await hub.readThreadState("thread-1")
  assert.equal(state.contextInclusions.length, 1)
  assert.equal(state.contextInclusions[0]?.mode, "retrieved")
  assert.equal(state.contextInclusions[0]?.sourceType, "history_message")
})

test("AgentThreadRunner prepares edited last user message by truncating the old turn output", async () => {
  const history = createThreadData({
    messages: [
      createUserMessage("user-1", "old question"),
      createAssistantMessage("assistant-1", "old answer")
    ],
    todos: [
      {
        content: "old todo",
        id: "todo-1",
        status: "pending"
      }
    ]
  })
  const hub = new AgentThreadRunner(createThreadsService(history))
  const seen: string[][] = []
  await hub.connectThreadEvents("thread-1", "subscriber", (batch) => {
    seen.push(batch.events.map((event) => event.type))
  })

  await hub.prepareEditLastUserMessageAndInvoke("thread-1", {
    content: "edited question",
    id: "user-1"
  })

  const snapshot = await hub.readThreadState("thread-1")
  assert.deepEqual(
    snapshot.messagesPage.map((message) => [message.id, message.content]),
    [["user-1", "edited question"]]
  )
  assert.equal(snapshot.status, "running")
  assert.equal(snapshot.activeRun?.userMessageId, "user-1")
  assert.deepEqual(snapshot.todos, [])
  assert.deepEqual(seen.at(-1), ["message.upserted", "message.truncatedAfter", "run.started"])
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
  await hub.prepareResume("thread-1", {
    request_id: "hitl:thread-1:run-1:tool-1",
    tool_call_id: "tool-1",
    type: "approve"
  })

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
  await hub.prepareResume("thread-1", {
    request_id: "hitl:thread-1:run-1:tool-1",
    tool_call_id: "tool-1",
    type: "approve"
  })

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
          contextInclusions: [],
          error: null,
          forkState: { canFork: true },
          pendingApproval: null,
          runId: null,
          todos: [],
          workspacePath: null
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
          contextInclusions: [],
          error: null,
          forkState: { canFork: true },
          pendingApproval: null,
          runId: null,
          todos: [],
          workspacePath: null
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

test("AgentThreadRunner merges finalized values tool calls into the live streamed assistant", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))

  await hub.prepareInvoke("thread-values-tool-calls", {
    content: "read package",
    id: "user-1"
  })
  await hub.handlePayload("thread-values-tool-calls", {
    data: [createSerializedAiMessage("streamed-assistant", "Reading package")],
    mode: "messages",
    type: "stream"
  })
  await hub.handlePayload("thread-values-tool-calls", {
    data: {
      messages: [
        {
          id: ["HumanMessage"],
          kwargs: {
            content: "read package",
            id: "user-1"
          },
          type: "human" as const
        },
        {
          id: ["AIMessage"],
          kwargs: {
            content: '{"file_path":"package.json"}',
            id: "values-assistant",
            tool_calls: [
              {
                args: {
                  file_path: "package.json"
                },
                id: "tool-call-1",
                name: "read_file",
                type: "tool_call"
              }
            ]
          },
          type: "ai" as const
        }
      ]
    },
    mode: "values",
    type: "stream"
  })

  const snapshot = await hub.readThreadState("thread-values-tool-calls")
  const assistant = snapshot.messagesPage.find((message) => message.id === "streamed-assistant")

  assert.equal(assistant?.content, "Reading package")
  assert.deepEqual(assistant?.tool_calls, [
    {
      args: {
        file_path: "package.json"
      },
      id: "tool-call-1",
      name: "read_file",
      type: "tool_call"
    }
  ])
  assert.equal(snapshot.activeRun?.assistantMessageId, "streamed-assistant")
  assert.equal(snapshot.activeRun?.currentToolCallId, "tool-call-1")
  assert.equal(snapshot.activeRun?.phase, "tool_running")
})

test("AgentThreadRunner applies pending values tool calls when values arrive before streamed assistant", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))

  await hub.prepareInvoke("thread-values-tool-calls-first", {
    content: "read package",
    id: "user-1"
  })
  await hub.handlePayload("thread-values-tool-calls-first", {
    data: {
      messages: [
        {
          id: ["HumanMessage"],
          kwargs: {
            content: "read package",
            id: "user-1"
          },
          type: "human" as const
        },
        {
          id: ["AIMessage"],
          kwargs: {
            content: '{"file_path":"package.json"}',
            id: "values-assistant",
            tool_calls: [
              {
                args: {
                  file_path: "package.json"
                },
                id: "tool-call-1",
                name: "read_file",
                type: "tool_call"
              }
            ]
          },
          type: "ai" as const
        }
      ]
    },
    mode: "values",
    type: "stream"
  })
  await hub.handlePayload("thread-values-tool-calls-first", {
    data: [createSerializedAiMessage("streamed-assistant", "")],
    mode: "messages",
    type: "stream"
  })

  const snapshot = await hub.readThreadState("thread-values-tool-calls-first")
  const assistant = snapshot.messagesPage.find((message) => message.id === "streamed-assistant")

  assert.deepEqual(
    assistant?.tool_calls?.map((toolCall) => toolCall.name),
    ["read_file"]
  )
  assert.equal(snapshot.activeRun?.currentToolCallId, "tool-call-1")
  assert.equal(snapshot.activeRun?.phase, "tool_running")
})

test("AgentThreadRunner exposes live thread data while persisted state lags runtime state", async () => {
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

  const liveSnapshot = hub.readLiveThreadDataSnapshot("thread-overlay", persistedThreadData)

  assert.equal(liveSnapshot?.thread.status, "busy")
  assert.deepEqual(
    liveSnapshot?.messages.messages.map((message) => ({ id: message.id, role: message.role })),
    [
      { id: "user-1", role: "user" },
      { id: "assistant-1", role: "assistant" }
    ]
  )
  assert.equal(liveSnapshot?.runState.runId, "run-1")

  await hub.handlePayload("thread-overlay", {
    type: "done"
  })

  const completedLiveSnapshot = hub.readLiveThreadDataSnapshot("thread-overlay", persistedThreadData)
  assert.equal(completedLiveSnapshot?.thread.status, "idle")
  assert.deepEqual(
    completedLiveSnapshot?.messages.messages.map((message) => ({ id: message.id, role: message.role })),
    [
      { id: "user-1", role: "user" },
      { id: "assistant-1", role: "assistant" }
    ]
  )

  const caughtUpPersistedThreadData = createThreadData({
    messages: completedLiveSnapshot?.messages.messages
  })
  assert.equal(hub.readLiveThreadDataSnapshot("thread-overlay", caughtUpPersistedThreadData), null)
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

test("AgentThreadRunner replays only events after the requested revision", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))

  await hub.prepareInvoke("thread-replay", {
    content: "stream please",
    id: "user-1"
  })
  await hub.handlePayload("thread-replay", {
    type: "stream",
    mode: "messages",
    data: [createSerializedAiMessage("assistant-1", "hello")]
  })
  await hub.handlePayload("thread-replay", {
    type: "stream",
    mode: "messages",
    data: [createSerializedAiMessage("assistant-1", " again")]
  })

  const replayedBatches: Array<{ latestRevision: number; revisions: number[] }> = []
  await hub.connectThreadEvents(
    "thread-replay",
    "runtime-subscriber",
    (batch) => {
      replayedBatches.push({
        latestRevision: batch.latestRevision,
        revisions: batch.events.map((event) => event.revision)
      })
    },
    { fromRevision: 2 }
  )

  assert.deepEqual(replayedBatches, [
    {
      latestRevision: 4,
      revisions: [3, 4]
    }
  ])
})

test("AgentThreadRunner preserves whitespace-only text chunks during token streaming", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))

  await hub.prepareInvoke("thread-whitespace-token", {
    content: "stream markdown please",
    id: "user-1"
  })

  for (const content of ["###", " ", "变更概要", "\n\n", "| 文件 | 变更 |"]) {
    await hub.handlePayload("thread-whitespace-token", {
      data: [
        {
          id: ["AIMessageChunk"],
          kwargs: {
            content: [
              {
                text: content,
                type: "text"
              }
            ],
            id: "assistant-1"
          },
          type: "ai"
        }
      ],
      mode: "messages",
      type: "stream"
    })
  }

  const snapshot = await hub.readThreadState("thread-whitespace-token")
  assert.deepEqual(snapshot.messagesPage.at(-1)?.content, [
    {
      text: "### 变更概要\n\n| 文件 | 变更 |",
      type: "text"
    }
  ])
})

test("AgentThreadRunner decodes structured-cloned LangChain AIMessageChunk token streaming", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))

  await hub.prepareInvoke("thread-live-langchain-token", {
    content: "stream please",
    id: "user-1"
  })

  for (const content of ["live ", "token ", "stream"]) {
    await hub.handlePayload("thread-live-langchain-token", {
      data: [createLiveLangChainAiMessageChunk("assistant-live-1", content)],
      mode: "messages",
      type: "stream"
    })
  }

  const snapshot = await hub.readThreadState("thread-live-langchain-token")
  assert.equal(snapshot.messagesPage.at(-1)?.content, "live token stream")
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

test("AgentThreadRunner surfaces streaming tool call chunks before completed tool calls arrive", async () => {
  const hub = new AgentThreadRunner(
    createThreadsService(
      createThreadData({
        messages: [createUserMessage("user-1", "Edit a file")]
      })
    )
  )
  const runtimeEventTypes: string[] = []

  await hub.connectThreadEvents("thread-tool-chunks", "runtime-subscriber", (batch) => {
    runtimeEventTypes.push(...batch.events.map((event) => event.type))
  })
  await hub.prepareResume("thread-tool-chunks")
  await hub.handlePayload("thread-tool-chunks", {
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content: "",
          id: "assistant-1",
          tool_call_chunks: [
            {
              args: '{"file_path":"src/',
              id: "tool-call-1",
              index: 0,
              name: "edit_file",
              type: "tool_call_chunk"
            }
          ]
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })
  await hub.handlePayload("thread-tool-chunks", {
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content: "",
          id: "assistant-1",
          tool_call_chunks: [
            {
              args: 'renderer.tsx","old_string":"old","new_string":"new"}',
              id: "tool-call-1",
              index: 0,
              type: "tool_call_chunk"
            }
          ]
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })

  const snapshot = await hub.readThreadState("thread-tool-chunks")
  const activeToolCall = snapshot.activeRun?.toolCalls[0]

  assert.deepEqual(runtimeEventTypes, ["run.resumed", "tool.callUpdated", "tool.callUpdated"])
  assert.equal(
    snapshot.messagesPage.some((message) => message.role === "assistant"),
    false
  )
  assert.equal(snapshot.activeRun?.assistantMessageId, "assistant-1")
  assert.equal(snapshot.activeRun?.currentToolCallId, "tool-call-1")
  assert.equal(activeToolCall?.name, "edit_file")
  assert.equal(
    activeToolCall?.argsText,
    '{"file_path":"src/renderer.tsx","old_string":"old","new_string":"new"}'
  )
  assert.equal(activeToolCall?.status, "arguments_streaming")
})

test("AgentThreadRunner materializes completed chunk-only tool calls from streaming args", async () => {
  const hub = new AgentThreadRunner(
    createThreadsService(
      createThreadData({
        messages: [createUserMessage("user-1", "Edit a file")]
      })
    )
  )
  const runtimeEventTypes: string[] = []

  await hub.connectThreadEvents("thread-tool-chunks-complete", "runtime-subscriber", (batch) => {
    runtimeEventTypes.push(...batch.events.map((event) => event.type))
  })
  await hub.prepareResume("thread-tool-chunks-complete")
  await hub.handlePayload("thread-tool-chunks-complete", {
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content: "",
          id: "assistant-1",
          tool_call_chunks: [
            {
              args: '{"file_path":"src/',
              id: "tool-call-1",
              index: 0,
              name: "edit_file",
              type: "tool_call_chunk"
            }
          ]
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })
  await hub.handlePayload("thread-tool-chunks-complete", {
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content: "",
          id: "assistant-1",
          tool_call_chunks: [
            {
              args: 'renderer.tsx","old_string":"old","new_string":"new"}',
              id: "tool-call-1",
              index: 0,
              type: "tool_call_chunk"
            }
          ]
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })
  const beforeToolResult = await hub.readThreadState("thread-tool-chunks-complete")
  const startedAt = beforeToolResult.activeRun?.toolCalls[0]?.startedAt

  await hub.handlePayload("thread-tool-chunks-complete", {
    data: [
      {
        id: ["ToolMessage"],
        kwargs: {
          content: "Successfully replaced 1 occurrence(s) in 'src/renderer.tsx'",
          id: "tool-result-1",
          name: "edit_file",
          tool_call_id: "tool-call-1"
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })

  const snapshot = await hub.readThreadState("thread-tool-chunks-complete")
  const assistantMessage = snapshot.messagesPage.find(
    (message) => message.id === "assistant-1" && message.role === "assistant"
  )
  const toolResultMessage = snapshot.messagesPage.find((message) => message.id === "tool-result-1")
  assert.ok(toolResultMessage)
  const timing = readJingleToolExecutionTiming(toolResultMessage)

  assert.deepEqual(assistantMessage?.tool_calls, [
    {
      args: {
        file_path: "src/renderer.tsx",
        new_string: "new",
        old_string: "old"
      },
      id: "tool-call-1",
      name: "edit_file",
      type: "tool_call"
    }
  ])
  assert.equal(timing?.messageId, "tool-result-1")
  assert.equal(timing?.toolCallId, "tool-call-1")
  assert.equal(timing?.toolName, "edit_file")
  assert.deepEqual(readFileMutationResultMetadata(toolResultMessage), {
    files: [
      {
        after: "new",
        before: "old",
        changeType: "modify",
        path: "src/renderer.tsx"
      }
    ],
    status: "completed",
    toolCallId: "tool-call-1",
    toolName: "edit_file"
  })
  assert.equal(timing?.startedAt?.getTime(), startedAt?.getTime())
  assert.equal(snapshot.activeRun?.currentToolCallId, null)
  assert.deepEqual(snapshot.activeRun?.toolCalls, [])
  assert.ok(runtimeEventTypes.includes("message.upserted"))
  assert.ok(runtimeEventTypes.includes("tool.started"))
  assert.ok(runtimeEventTypes.includes("tool.updated"))
})

test("AgentThreadRunner stores failed tool execution facts on tool result messages", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))
  const runtimeEventTypes: string[] = []

  await hub.connectThreadEvents("thread-tool-failed", "runtime-subscriber", (batch) => {
    runtimeEventTypes.push(...batch.events.map((event) => event.type))
  })
  await hub.prepareInvoke("thread-tool-failed", {
    content: "Run command",
    id: "user-1"
  })
  await hub.handlePayload("thread-tool-failed", { runId: "run-1", type: "run_started" })
  await hub.handlePayload("thread-tool-failed", {
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content: "",
          id: "assistant-1",
          tool_calls: [
            {
              args: { command: "exit 1" },
              id: "tool-call-1",
              name: "bash",
              type: "tool_call"
            }
          ]
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })

  const afterToolStarted = await hub.readThreadState("thread-tool-failed")
  const startedAt = afterToolStarted.activeRun?.toolCalls[0]?.startedAt
  assert.equal(afterToolStarted.activeRun?.toolCalls[0]?.status, "running")
  assert.equal(startedAt instanceof Date, true)

  await hub.handlePayload("thread-tool-failed", {
    data: [
      {
        id: ["ToolMessage"],
        kwargs: {
          content: "command failed",
          id: "tool-result-1",
          name: "bash",
          status: "error",
          tool_call_id: "tool-call-1"
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })

  const snapshot = await hub.readThreadState("thread-tool-failed")
  const toolMessage = snapshot.messagesPage.find((message) => message.id === "tool-result-1")
  assert.ok(toolMessage)
  assert.equal(typeof toolMessage.metadata?.[JINGLE_TOOL_EXECUTION_METADATA_KEY], "object")

  const timing = readJingleToolExecutionTiming(toolMessage)
  assert.equal(timing?.status, "failed")
  assert.equal(timing?.toolCallId, "tool-call-1")
  assert.equal(timing?.messageId, "tool-result-1")
  assert.equal(timing?.runId, "run-1")
  assert.equal(timing?.toolName, "bash")
  assert.equal(timing?.error?.message, "command failed")
  assert.equal(timing?.startedAt?.getTime(), startedAt?.getTime())
  assert.equal(timing?.completedAt instanceof Date, true)
  assert.equal(typeof timing?.durationMs, "number")
  assert.ok((timing?.durationMs ?? -1) >= 0)
  assert.equal(snapshot.activeRun?.phase, "thinking")
  assert.equal(snapshot.activeRun?.currentToolCallId, null)
  assert.deepEqual(snapshot.activeRun?.toolCalls, [])
  assert.ok(runtimeEventTypes.includes("tool.started"))
  assert.ok(runtimeEventTypes.includes("tool.updated"))
})

test("AgentThreadRunner does not attach completed file mutation metadata to failed edit results", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))

  await hub.prepareInvoke("thread-file-mutation-error", {
    content: "Edit a file",
    id: "user-1"
  })
  await hub.handlePayload("thread-file-mutation-error", { runId: "run-1", type: "run_started" })
  await hub.handlePayload("thread-file-mutation-error", {
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content: "",
          id: "assistant-1",
          tool_calls: [
            {
              args: {
                file_path: "src/app.ts",
                new_string: "next",
                old_string: "current"
              },
              id: "tool-call-1",
              name: "edit_file",
              type: "tool_call"
            }
          ]
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })
  await hub.handlePayload("thread-file-mutation-error", {
    data: [
      {
        id: ["ToolMessage"],
        kwargs: {
          content: "Error: String 'current' has multiple occurrences (appears 2 times) in file.",
          id: "tool-result-1",
          name: "edit_file",
          tool_call_id: "tool-call-1"
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })

  const snapshot = await hub.readThreadState("thread-file-mutation-error")
  const toolMessage = snapshot.messagesPage.find((message) => message.id === "tool-result-1")

  assert.ok(toolMessage)
  assert.equal(readFileMutationResultMetadata(toolMessage), null)
})

test("AgentThreadRunner does not guess write_file completed result change type", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))

  await hub.prepareInvoke("thread-file-write-complete", {
    content: "Write a file",
    id: "user-1"
  })
  await hub.handlePayload("thread-file-write-complete", { runId: "run-1", type: "run_started" })
  await hub.handlePayload("thread-file-write-complete", {
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content: "",
          id: "assistant-1",
          tool_calls: [
            {
              args: {
                content: "hello",
                file_path: "src/notes.md"
              },
              id: "tool-call-1",
              name: "write_file",
              type: "tool_call"
            }
          ]
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })
  await hub.handlePayload("thread-file-write-complete", {
    data: [
      {
        id: ["ToolMessage"],
        kwargs: {
          content: "Successfully wrote to 'src/notes.md'",
          id: "tool-result-1",
          tool_call_id: "tool-call-1"
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })

  const snapshot = await hub.readThreadState("thread-file-write-complete")
  const toolMessage = snapshot.messagesPage.find((message) => message.id === "tool-result-1")

  assert.ok(toolMessage)
  assert.deepEqual(readFileMutationResultMetadata(toolMessage), {
    files: [
      {
        after: "hello",
        before: null,
        changeType: null,
        path: "src/notes.md"
      }
    ],
    status: "completed",
    toolCallId: "tool-call-1",
    toolName: "write_file"
  })
})

test("AgentThreadRunner backfills write_file metadata when values tool args arrive after result", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))

  await hub.prepareInvoke("thread-file-write-values-after-result", {
    content: "Write a file",
    id: "user-1"
  })
  await hub.handlePayload("thread-file-write-values-after-result", {
    data: [createSerializedAiMessage("assistant-1", "直接用文件工具生成一个文本文件。")],
    mode: "messages",
    type: "stream"
  })
  await hub.handlePayload("thread-file-write-values-after-result", {
    data: [
      {
        id: ["ToolMessage"],
        kwargs: {
          content: "Successfully wrote to 'src/notes.md'",
          id: "tool-result-1",
          name: "write_file",
          tool_call_id: "tool-call-1"
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })

  const beforeValues = await hub.readThreadState("thread-file-write-values-after-result")
  const toolMessageBeforeValues = beforeValues.messagesPage.find(
    (message) => message.id === "tool-result-1"
  )
  assert.ok(toolMessageBeforeValues)
  assert.equal(readFileMutationResultMetadata(toolMessageBeforeValues), null)

  await hub.handlePayload("thread-file-write-values-after-result", {
    data: {
      messages: [
        {
          id: ["HumanMessage"],
          kwargs: {
            content: "Write a file",
            id: "user-1"
          },
          type: "human" as const
        },
        {
          id: ["AIMessage"],
          kwargs: {
            content: "",
            id: "values-assistant",
            tool_calls: [
              {
                args: {
                  content: "hello",
                  file_path: "src/notes.md"
                },
                id: "tool-call-1",
                name: "write_file",
                type: "tool_call"
              }
            ]
          },
          type: "ai" as const
        }
      ]
    },
    mode: "values",
    type: "stream"
  })

  const snapshot = await hub.readThreadState("thread-file-write-values-after-result")
  const toolMessage = snapshot.messagesPage.find((message) => message.id === "tool-result-1")

  assert.ok(toolMessage)
  assert.deepEqual(readFileMutationResultMetadata(toolMessage), {
    files: [
      {
        after: "hello",
        before: null,
        changeType: null,
        path: "src/notes.md"
      }
    ],
    status: "completed",
    toolCallId: "tool-call-1",
    toolName: "write_file"
  })
})

test("AgentThreadRunner does not merge completed values tool calls into the final answer", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))

  await hub.prepareInvoke("thread-values-final-after-tool", {
    content: "Search docs",
    id: "user-1"
  })
  await hub.handlePayload("thread-values-final-after-tool", { runId: "run-1", type: "run_started" })
  await hub.handlePayload("thread-values-final-after-tool", {
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content: "",
          id: "assistant-tools",
          tool_calls: [
            {
              args: { query: "agent" },
              id: "tool-call-1",
              name: "searchPages",
              type: "tool_call"
            }
          ]
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })
  await hub.handlePayload("thread-values-final-after-tool", {
    data: [
      {
        id: ["ToolMessage"],
        kwargs: {
          content: "search result",
          id: "tool-result-1",
          name: "searchPages",
          tool_call_id: "tool-call-1"
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })
  await hub.handlePayload("thread-values-final-after-tool", {
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content: "Final answer",
          id: "assistant-final"
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })
  await hub.handlePayload("thread-values-final-after-tool", {
    data: {
      messages: [
        {
          id: ["HumanMessage"],
          kwargs: {
            content: "Search docs",
            id: "user-1"
          },
          type: "human" as const
        },
        {
          id: ["AIMessage"],
          kwargs: {
            content: "",
            id: "values-tools",
            tool_calls: [
              {
                args: {
                  query: "agent"
                },
                id: "tool-call-1",
                name: "searchPages",
                type: "tool_call"
              }
            ]
          },
          type: "ai" as const
        },
        {
          id: ["ToolMessage"],
          kwargs: {
            content: "search result",
            id: "tool-result-1",
            name: "searchPages",
            tool_call_id: "tool-call-1"
          },
          type: "tool" as const
        },
        createSerializedAiMessage("values-final", "Final answer")
      ]
    },
    mode: "values",
    type: "stream"
  })

  const snapshot = await hub.readThreadState("thread-values-final-after-tool")
  const assistantMessages = snapshot.messagesPage.filter((message) => message.role === "assistant")

  assert.equal(assistantMessages.length, 2)
  assert.equal(assistantMessages[0]?.id, "assistant-tools")
  assert.equal(assistantMessages[0]?.tool_calls?.[0]?.id, "tool-call-1")
  assert.equal(assistantMessages[1]?.id, "assistant-final")
  assert.equal(assistantMessages[1]?.content, "Final answer")
  assert.equal(assistantMessages[1]?.tool_calls, undefined)
  assert.equal(snapshot.activeRun?.assistantMessageId, "assistant-final")
  assert.equal(snapshot.activeRun?.currentToolCallId, null)
  assert.equal(snapshot.activeRun?.phase, "streaming")
})

test("AgentThreadRunner does not fabricate tool start timing when only a tool result arrives", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))

  await hub.prepareInvoke("thread-tool-result-only", {
    content: "Run command",
    id: "user-1"
  })
  await hub.handlePayload("thread-tool-result-only", { runId: "run-1", type: "run_started" })
  await hub.handlePayload("thread-tool-result-only", {
    data: [
      {
        id: ["ToolMessage"],
        kwargs: {
          content: "done",
          id: "tool-result-1",
          name: "bash",
          tool_call_id: "tool-call-1"
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })

  const snapshot = await hub.readThreadState("thread-tool-result-only")
  const toolMessage = snapshot.messagesPage.find((message) => message.id === "tool-result-1")
  assert.ok(toolMessage)

  const timing = readJingleToolExecutionTiming(toolMessage)
  assert.equal(timing?.status, "completed")
  assert.equal(timing?.toolCallId, "tool-call-1")
  assert.equal(timing?.startedAt, undefined)
  assert.equal(timing?.durationMs, undefined)
  assert.equal(timing?.completedAt instanceof Date, true)
})

test("AgentThreadRunner reads OpenAI-style streamed tool calls from additional kwargs", async () => {
  const history = createThreadData({
    messages: [],
    todos: []
  })
  const hub = new AgentThreadRunner(createThreadsService(history))

  await hub.handlePayload("thread-openai-tool-call", {
    type: "stream",
    mode: "messages",
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          additional_kwargs: {
            tool_calls: [
              {
                function: {
                  arguments: '{"path":"README.md"}',
                  name: "read_file"
                },
                id: "tool-call-openai-1",
                type: "function"
              }
            ]
          },
          content: "",
          id: "assistant-openai-tool-call"
        },
        type: "ai" as const
      },
      {}
    ]
  })

  const snapshot = await hub.readThreadState("thread-openai-tool-call")
  const message = snapshot.messagesPage.at(-1)
  assert.equal(message?.id, "assistant-openai-tool-call")
  assert.equal(message?.content, "")
  assert.deepEqual(message?.tool_calls, [
    {
      args: {
        path: "README.md"
      },
      id: "tool-call-openai-1",
      name: "read_file",
      type: "tool_call"
    }
  ])
})

test("AgentThreadRunner skips partial OpenAI-style streamed tool call arguments", async () => {
  const history = createThreadData({
    messages: [],
    todos: []
  })
  const hub = new AgentThreadRunner(createThreadsService(history))

  await hub.handlePayload("thread-openai-partial-tool-call", {
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          additional_kwargs: {
            tool_calls: [
              {
                function: {
                  arguments: '{"path":"READ',
                  name: "read_file"
                },
                id: "tool-call-openai-partial-1",
                type: "function"
              }
            ]
          },
          content: "I will inspect the file.",
          id: "assistant-openai-partial-tool-call"
        },
        type: "ai" as const
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })

  const snapshot = await hub.readThreadState("thread-openai-partial-tool-call")
  const message = snapshot.messagesPage.at(-1)
  assert.equal(message?.id, "assistant-openai-partial-tool-call")
  assert.equal(message?.content, "I will inspect the file.")
  assert.equal(message?.tool_calls, undefined)
})

test("AgentThreadRunner ignores OpenAI-style streamed tool calls until the function name arrives", async () => {
  const history = createThreadData({
    messages: [],
    todos: []
  })
  const hub = new AgentThreadRunner(createThreadsService(history))

  await hub.handlePayload("thread-openai-unnamed-tool-call", {
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          additional_kwargs: {
            tool_calls: [
              {
                function: {
                  arguments: '{"path":"README.md"}'
                },
                id: "tool-call-openai-unnamed-1",
                type: "function"
              }
            ]
          },
          content: "I will inspect the file.",
          id: "assistant-openai-unnamed-tool-call"
        },
        type: "ai" as const
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })

  const snapshot = await hub.readThreadState("thread-openai-unnamed-tool-call")
  const message = snapshot.messagesPage.at(-1)
  assert.equal(message?.id, "assistant-openai-unnamed-tool-call")
  assert.equal(message?.content, "I will inspect the file.")
  assert.equal(message?.tool_calls, undefined)
})

test("AgentThreadRunner starts a new assistant message after tool results", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))

  await hub.prepareInvoke("thread-final-after-tool", {
    content: "Search docs",
    id: "user-1"
  })
  await hub.handlePayload("thread-final-after-tool", { runId: "run-1", type: "run_started" })
  await hub.handlePayload("thread-final-after-tool", {
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content: "",
          id: "assistant-tools",
          tool_calls: [
            {
              args: { query: "agent" },
              id: "tool-call-1",
              name: "searchPages",
              type: "tool_call"
            }
          ]
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })
  await hub.handlePayload("thread-final-after-tool", {
    data: [
      {
        id: ["ToolMessage"],
        kwargs: {
          content: "search result",
          id: "tool-result-1",
          name: "searchPages",
          tool_call_id: "tool-call-1"
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })
  await hub.handlePayload("thread-final-after-tool", {
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content: "Final answer"
        }
      },
      {}
    ],
    mode: "messages",
    type: "stream"
  })

  const snapshot = await hub.readThreadState("thread-final-after-tool")
  const assistantMessages = snapshot.messagesPage.filter((message) => message.role === "assistant")

  assert.equal(assistantMessages.length, 2)
  assert.equal(assistantMessages[0]?.id, "assistant-tools")
  assert.equal(assistantMessages[0]?.content, "")
  assert.equal(assistantMessages[0]?.tool_calls?.[0]?.id, "tool-call-1")
  assert.equal(assistantMessages[1]?.content, "Final answer")
  assert.equal(assistantMessages[1]?.tool_calls, undefined)
  assert.equal(snapshot.activeRun?.assistantMessageId, assistantMessages[1]?.id)
  assert.equal(snapshot.activeRun?.phase, "streaming")
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

test("AgentThreadRunner ignores title generation message stream chunks", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))

  await hub.prepareInvoke("thread-title-stream", {
    content: "Summarize current doc",
    id: "user-1"
  })
  const beforeTitle = await hub.readThreadState("thread-title-stream")

  await hub.handlePayload("thread-title-stream", {
    data: [
      {
        id: ["AIMessageChunk"],
        kwargs: {
          content: "检查文档中Agent相关内容",
          id: "title-generation-message"
        }
      },
      {
        name: "thread_title"
      }
    ],
    mode: "messages",
    type: "stream"
  })

  const afterTitle = await hub.readThreadState("thread-title-stream")
  assert.equal(afterTitle.revision, beforeTitle.revision)
  assert.deepEqual(afterTitle.messagesPage, beforeTitle.messagesPage)
})

test("AgentThreadRunner emits follow-up queue runtime events", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))
  const seen: string[][] = []

  await hub.connectThreadEvents("thread-follow-up", "subscriber", (batch) => {
    seen.push(batch.events.map((event) => event.type))
  })
  const queued = await hub.enqueueFollowUp("thread-follow-up", {
    messageInput: { refs: [], text: "queued follow-up" }
  })

  const queuedState = await hub.readThreadState("thread-follow-up")
  assert.deepEqual(seen, [["followUp.queueChanged"]])
  assert.equal(queuedState.followUpQueue.count, 1)
  assert.equal(queuedState.followUpQueue.nextRequestId, queued.requestId)

  const taken = await hub.takeFollowUp("thread-follow-up", queued.requestId)
  assert.deepEqual(taken, queued)
  const emptyState = await hub.readThreadState("thread-follow-up")
  assert.deepEqual(emptyState.followUpQueue, {
    count: 0,
    items: [],
    nextRequestId: null
  })

  await hub.restoreFollowUp("thread-follow-up", queued)
  await hub.removeFollowUp("thread-follow-up", queued.requestId)
  const finalState = await hub.readThreadState("thread-follow-up")
  assert.deepEqual(finalState.followUpQueue, {
    count: 0,
    items: [],
    nextRequestId: null
  })
  assert.deepEqual(seen, [
    ["followUp.queueChanged"],
    ["followUp.queueChanged"],
    ["followUp.queueChanged"],
    ["followUp.queueChanged"]
  ])
})

test("AgentThreadRunner materializes steered messages when they are applied", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))
  const acceptedAt = new Date("2026-01-01T00:00:01.000Z")
  const eventTypes: string[] = []
  await hub.connectThreadEvents("thread-steer-applied", "events", (batch) => {
    eventTypes.push(...batch.events.map((event) => event.type))
  })
  await hub.prepareSteeringMessage(
    "thread-steer-applied",
    {
      content: "Use the smaller fix",
      id: "steer-1"
    },
    acceptedAt
  )

  const pendingState = await hub.readThreadState("thread-steer-applied")
  const pendingMessage = pendingState.messagesPage.find((entry) => entry.id === "steer-1")
  assert.equal(pendingMessage?.role, "user")
  assert.equal(pendingMessage?.content, "Use the smaller fix")
  assert.equal(readJingleSteeringStatus(pendingMessage?.metadata), "pending")

  await hub.markSteeringApplied("thread-steer-applied", [
    {
      acceptedAt,
      content: "Use the smaller fix",
      messageId: "steer-1",
      runId: "run-1",
      text: "Use the smaller fix"
    }
  ])

  const state = await hub.readThreadState("thread-steer-applied")
  const message = state.messagesPage.find((entry) => entry.id === "steer-1")
  assert.equal(message?.role, "user")
  assert.equal(message?.content, "Use the smaller fix")
  assert.equal(message?.created_at.toISOString(), acceptedAt.toISOString())
  assert.equal(readJingleSteeringStatus(message?.metadata), "applied")
  const marker = state.messagesPage.find((entry) => entry.id === "steer-applied:steer-1")
  assert.equal(marker?.role, "system")
  assert.deepEqual(readJingleSteeringAppliedMarker(marker?.metadata), {
    kind: "applied",
    messageId: "steer-1",
    runId: "run-1"
  })
  assert.deepEqual(eventTypes, [
    "message.upserted",
    "message.upserted",
    "message.upserted",
    "steer.applied"
  ])
})

test("AgentThreadRunner can materialize applied steers without a pending display message", async () => {
  const hub = new AgentThreadRunner(createThreadsService(createThreadData()))
  const acceptedAt = new Date("2026-01-01T00:00:01.000Z")

  await hub.markSteeringApplied("thread-steer-applied-late", [
    {
      acceptedAt,
      content: "Use the smaller fix",
      messageId: "steer-1",
      runId: "run-1",
      text: "Use the smaller fix"
    }
  ])

  const state = await hub.readThreadState("thread-steer-applied-late")
  const message = state.messagesPage.find((entry) => entry.id === "steer-1")
  assert.equal(message?.role, "user")
  assert.equal(message?.content, "Use the smaller fix")
  assert.equal(message?.created_at.toISOString(), acceptedAt.toISOString())
  assert.equal(readJingleSteeringStatus(message?.metadata), "applied")
  const marker = state.messagesPage.find((entry) => entry.id === "steer-applied:steer-1")
  assert.equal(marker?.role, "system")
  assert.deepEqual(readJingleSteeringAppliedMarker(marker?.metadata), {
    kind: "applied",
    messageId: "steer-1",
    runId: "run-1"
  })
})
