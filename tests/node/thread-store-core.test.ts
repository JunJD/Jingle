import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_PERMISSION_MODE } from "../../src/shared/permission-mode"
import type { AgentThreadEvent } from "../../src/shared/agent-thread-contract"
import { reduceJingleAgentThreadRuntimeEvent } from "@jingle/agent-client"
import {
  createDefaultAgentThreadRuntimeState
} from "../../src/shared/agent-thread-contract"
import type { JingleActiveAgentRun } from "@jingle/agent-client"
import type { AgentThreadDataSnapshot } from "../../src/shared/app-types"
import type { HITLRequest } from "../../src/shared/hitl"
import type { ArtifactRecord } from "../../src/shared/artifacts"
import {
  createThreadStore,
  type ThreadState,
  type ThreadStore
} from "../../src/renderer/src/lib/thread-store-core"
import type { Message } from "../../src/renderer/src/types"

function getThreadState(store: ThreadStore, threadId: string): ThreadState {
  const state = store.getThreadState(threadId)
  assert.ok(state, `Expected thread state for ${threadId}`)
  return state
}

function createLinkArtifact(props: {
  id: string
  threadId: string
  title: string
  toolCallId: string
}): ArtifactRecord {
  return {
    artifactKey: `${props.toolCallId}:0`,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    id: props.id,
    kind: "link",
    messageId: null,
    mimeType: null,
    payload: null,
    previewText: null,
    runId: null,
    sizeBytes: null,
    source: {
      type: "external-url",
      uri: "https://example.com"
    },
    status: "ready",
    subtitle: null,
    threadId: props.threadId,
    title: props.title,
    toolCallId: props.toolCallId,
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  }
}

function createUserMessage(id: string, content = "User message"): Message {
  return {
    content,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    id,
    role: "user"
  }
}

function createAssistantMessage(id: string, content = "Assistant message"): Message {
  return {
    content,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    id,
    role: "assistant"
  }
}

function createActiveRun(): JingleActiveAgentRun {
  return {
    assistantMessageId: null,
    currentToolCallId: null,
    phase: "thinking",
    phaseStartedAt: new Date("2026-01-01T00:00:00.000Z"),
    runId: null,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "running",
    threadId: "thread-a",
    toolCalls: [],
    turnId: "user-1",
    userMessageId: "user-1"
  }
}

function createThreadDataSnapshot(
  input: Partial<AgentThreadDataSnapshot>
): AgentThreadDataSnapshot {
  return {
    thread: {
      metadata: undefined,
      status: "idle",
      thread_id: "thread-a",
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
    },
    ...input
  }
}

function createPendingApproval(): HITLRequest {
  return {
    allowed_decisions: ["approve", "reject"],
    id: "hitl:thread-a:run-1:tool-1",
    review: null,
    tool_call: {
      args: {},
      id: "tool-1",
      name: "bash",
      type: "tool_call"
    }
  }
}

function installAgentQueueApiStub(): {
  calls: Array<{ input: unknown; type: "enqueue" | "remove" | "restore" | "steer" | "take" }>
} {
  const calls: Array<{ input: unknown; type: "enqueue" | "remove" | "restore" | "steer" | "take" }> =
    []
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      api: {
        agent: {
          enqueueFollowUp: async (threadId: string, messageInput: unknown) => {
            calls.push({ input: { messageInput, threadId }, type: "enqueue" })
            return {
              messageInput,
              requestId: "request-1",
              text: "first follow-up"
            }
          },
          removeFollowUp: async (threadId: string, requestId: string) => {
            calls.push({ input: { requestId, threadId }, type: "remove" })
          },
          restoreFollowUp: async (threadId: string, item: unknown) => {
            calls.push({ input: { item, threadId }, type: "restore" })
          },
          steerFollowUp: async (threadId: string, requestId: string) => {
            calls.push({ input: { requestId, threadId }, type: "steer" })
            return { ok: true }
          },
          takeFollowUp: async (threadId: string, requestId: string) => {
            calls.push({ input: { requestId, threadId }, type: "take" })
            return {
              messageInput: {
                refs: [],
                text: "first follow-up"
              },
              requestId,
              text: "first follow-up"
            }
          }
        }
      }
    }
  })

  return { calls }
}

function createLongConversationMessages(turnCount: number): Message[] {
  const messages: Message[] = []
  for (let index = 0; index < turnCount; index += 1) {
    messages.push(
      createUserMessage(`user-${index}`, `Question ${index}`),
      createAssistantMessage(`assistant-${index}`, `Answer ${index}`)
    )
  }

  return messages
}

test("uninitialized thread reads do not create default state", () => {
  const store = createThreadStore()

  assert.equal(store.getThreadState("thread-a"), null)
})

test("thread subscriptions stay scoped to the matching thread id", () => {
  const store = createThreadStore()
  let threadACalls = 0
  const unsubscribeThread = store.subscribeThread("thread-a", () => {
    threadACalls += 1
  })
  store.ensureThreadState("thread-a")
  store.ensureThreadState("thread-b")
  store.getThreadControl("thread-a").local.openFile("/tmp/a.txt", "a.txt")

  unsubscribeThread()
  assert.equal(threadACalls, 2)
  assert.deepEqual(getThreadState(store, "thread-a").ui.openFiles, [
    {
      name: "a.txt",
      path: "/tmp/a.txt"
    }
  ])
  assert.deepEqual(getThreadState(store, "thread-b").ui.openFiles, [])
  assert.equal(getThreadState(store, "thread-b").agent.permissionMode, DEFAULT_PERMISSION_MODE)
})

test("thread agent control delegates follow-up queue edits to main runtime owner", async () => {
  const { calls } = installAgentQueueApiStub()
  const store = createThreadStore()
  const control = store.getThreadControl("thread-a").agent
  const first = await control.enqueueFollowUp({
    refs: [],
    text: " first follow-up "
  })
  const taken = await control.takeFollowUp(first.requestId)
  await control.restoreFollowUp(first)
  const steered = await control.steerFollowUp(first.requestId)
  await control.removeFollowUp(first.requestId)

  assert.deepEqual(taken, {
    messageInput: {
      refs: [],
      text: "first follow-up"
    },
    requestId: "request-1",
    text: "first follow-up"
  })
  assert.deepEqual(steered, { ok: true })
  assert.equal(store.getThreadState("thread-a"), null)
  assert.deepEqual(calls, [
    {
      input: {
        messageInput: {
          refs: [],
          text: " first follow-up "
        },
        threadId: "thread-a"
      },
      type: "enqueue"
    },
    {
      input: {
        requestId: "request-1",
        threadId: "thread-a"
      },
      type: "take"
    },
    {
      input: {
        item: first,
        threadId: "thread-a"
      },
      type: "restore"
    },
    {
      input: {
        requestId: "request-1",
        threadId: "thread-a"
      },
      type: "steer"
    },
    {
      input: {
        requestId: "request-1",
        threadId: "thread-a"
      },
      type: "remove"
    }
  ])
})

test("artifact changed events update source artifacts without rewriting open tab facts", () => {
  const store = createThreadStore()
  const localControl = store.getThreadControl("thread-a").local

  localControl.openArtifactTab({
    artifactId: "artifact-1"
  })
  const artifact = createLinkArtifact({
    id: "artifact-1",
    threadId: "thread-a",
    title: "Published link",
    toolCallId: "tool-call-1"
  })
  store.applyArtifactsChanged("thread-a", [artifact])

  assert.deepEqual(getThreadState(store, "thread-a").ui.openArtifacts, [
    {
      artifactId: "artifact-1"
    }
  ])
  assert.deepEqual(getThreadState(store, "thread-a").agent.artifacts, [artifact])
})
test("thread data snapshots update message projection without emitting for equivalent snapshots", () => {
  const store = createThreadStore()
  let calls = 0

  const unsubscribe = store.subscribeThread("thread-a", () => {
    calls += 1
  })
  const messages = [createUserMessage("user-1"), createAssistantMessage("assistant-1", "Hello")]

  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages
      }
    })
  )
  const firstProjection = getThreadState(store, "thread-a").view.messageProjection
  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: structuredClone(messages)
      }
    })
  )
  const equivalentProjection = getThreadState(store, "thread-a").view.messageProjection
  store.applyRuntimeEvents("thread-a", [
    {
      message: createAssistantMessage("assistant-1", "Hello again"),
      revision: 1,
      type: "message.upserted"
    }
  ])
  const updatedProjection = getThreadState(store, "thread-a").view.messageProjection
  unsubscribe()

  assert.equal(calls, 2)
  assert.equal(equivalentProjection, firstProjection)
  assert.notEqual(updatedProjection, firstProjection)
  assert.equal(updatedProjection.turns[0]?.user, firstProjection.turns[0]?.user)
  assert.equal(updatedProjection.turns[0]?.assistants[0]?.content, "Hello again")
})

test("message projection uses runtime-owned active turn from thread state", () => {
  const store = createThreadStore()

  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: [
          createUserMessage("user-1", "First question"),
          createAssistantMessage("assistant-1", "First answer"),
          createUserMessage("user-2", "Second question")
        ]
      }
    })
  )
  store.applyRuntimeEvents("thread-a", [
    {
      revision: 1,
      run: {
        assistantMessageId: null,
        currentToolCallId: null,
        phase: "thinking",
        phaseStartedAt: new Date("2026-01-01T00:00:00.000Z"),
        runId: "run-1",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "running",
        threadId: "thread-a",
        toolCalls: [],
        turnId: "user-2",
        userMessageId: "user-2"
      },
      type: "run.started"
    }
  ])

  const state = getThreadState(store, "thread-a")
  assert.equal(state.view.messageProjection.activeTurnKey, "user-2")
  assert.equal(state.view.messageProjection.activeAssistantId, null)
})

test("thread data snapshot and events update thread state through store reducer", () => {
  const store = createThreadStore()
  const activeRun = createActiveRun()
  const artifact = createLinkArtifact({
    id: "artifact-1",
    threadId: "thread-a",
    title: "Published link",
    toolCallId: "tool-call-1"
  })

  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [artifact],
        messages: [createUserMessage("user-1", "Question")]
      },
      runState: {
        contextInclusions: [],
        error: null,
        forkState: { canFork: true },
        pendingApproval: null,
        runId: activeRun.runId,
        todos: [],
        workspacePath: "/tmp/launcher-ai-first-send"
      },
      thread: {
        metadata: {
          model: "openai:gpt-4o",
          permissionMode: "auto"
        },
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  store.applyRuntimeEvents("thread-a", [
    {
      revision: 1,
      run: activeRun,
      type: "run.started"
    },
    {
      message: createAssistantMessage("assistant-1", "Hello"),
      revision: 2,
      type: "message.upserted"
    },
    {
      revision: 3,
      runId: "run-1",
      type: "run.idAssigned"
    }
  ])

  const state = getThreadState(store, "thread-a")
  assert.equal(state.agent.revision, 3)
  assert.equal(state.agent.latestRunId, "run-1")
  assert.equal(state.agent.activeRun?.assistantMessageId, "assistant-1")
  assert.deepEqual(state.agent.artifacts, [artifact])
  assert.deepEqual(state.agent.forkState, { canFork: true })
  assert.equal(state.agent.workspacePath, "/tmp/launcher-ai-first-send")
  assert.equal(state.agent.currentModel, "openai:gpt-4o")
  assert.equal(state.agent.permissionMode, "auto")
  assert.equal(state.view.messageProjection.activeTurnKey, "user-1")
  assert.deepEqual(
    state.agent.messagesPage.map((message) => message.id),
    ["user-1", "assistant-1"]
  )
})

test("runtime event path maps shared reducer state into renderer source facts", () => {
  const store = createThreadStore()
  const events: AgentThreadEvent[] = [
    {
      message: createUserMessage("user-1", "Question"),
      revision: 1,
      type: "message.upserted"
    },
    {
      revision: 2,
      run: {
        assistantMessageId: null,
        currentToolCallId: null,
        phase: "thinking",
        phaseStartedAt: new Date("2026-01-01T00:00:00.000Z"),
        runId: null,
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "running",
        threadId: "thread-a",
        toolCalls: [],
        turnId: "user-1",
        userMessageId: "user-1"
      },
      type: "run.started"
    },
    {
      message: createAssistantMessage("assistant-1", "Hello"),
      revision: 3,
      type: "message.upserted"
    },
    {
      delta: " world",
      deltaAt: new Date("2026-01-01T00:00:01.000Z"),
      field: "text",
      messageId: "assistant-1",
      partId: "content",
      revision: 4,
      type: "message.part.delta"
    },
    {
      approval: createPendingApproval(),
      requestedAt: new Date("2026-01-01T00:00:02.000Z"),
      revision: 5,
      runId: null,
      type: "approval.requested"
    }
  ]

  store.applyRuntimeEvents("thread-a", events)

  const sharedRuntimeState = events.reduce(
    reduceJingleAgentThreadRuntimeEvent,
    createDefaultAgentThreadRuntimeState("thread-a")
  )
  const state = getThreadState(store, "thread-a")
  assert.deepEqual(state.agent.activeRun, sharedRuntimeState.activeRun)
  assert.deepEqual(state.agent.messagesPage, sharedRuntimeState.messagesPage)
  assert.deepEqual(state.agent.pendingApproval, sharedRuntimeState.pendingApproval)
  assert.equal(state.agent.revision, sharedRuntimeState.revision)
  assert.equal(state.agent.latestRunId, sharedRuntimeState.latestRunId)
  assert.equal(state.view.messageProjection.activeAssistantId, "assistant-1")
  assert.equal(state.view.messageProjection.activeTurnKey, "user-1")
})

test("run started immediately moves projection active turn before assistant first token", () => {
  const store = createThreadStore()

  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: [
          createUserMessage("user-1", "First question"),
          createAssistantMessage("assistant-1", "First answer")
        ]
      },
      runState: {
        contextInclusions: [],
        error: null,
        forkState: { canFork: true },
        pendingApproval: null,
        runId: null,
        todos: [],
        workspacePath: null
      },
      thread: {
        metadata: undefined,
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  const firstProjection = getThreadState(store, "thread-a").view.messageProjection
  assert.equal(firstProjection.activeTurnKey, "user-1")

  store.applyRuntimeEvents("thread-a", [
    {
      message: createUserMessage("user-2", "Second question"),
      revision: 1,
      type: "message.upserted"
    },
    {
      revision: 2,
      run: {
        assistantMessageId: null,
        currentToolCallId: null,
        phase: "thinking",
        phaseStartedAt: new Date("2026-01-01T00:00:00.000Z"),
        runId: null,
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "running",
        threadId: "thread-a",
        toolCalls: [],
        turnId: "user-2",
        userMessageId: "user-2"
      },
      type: "run.started"
    }
  ])

  const state = getThreadState(store, "thread-a")
  assert.equal(state.agent.activeRun?.turnId, "user-2")
  assert.equal(state.view.messageProjection.activeTurnKey, "user-2")
  assert.equal(state.view.messageProjection.activeAssistantId, null)

  store.applyRuntimeEvents("thread-a", [
    {
      message: createAssistantMessage("assistant-2", "Streaming"),
      revision: 3,
      type: "message.upserted"
    }
  ])

  const streamingState = getThreadState(store, "thread-a")
  assert.equal(streamingState.agent.activeRun?.assistantMessageId, "assistant-2")
  assert.equal(streamingState.view.messageProjection.activeTurnKey, "user-2")
  assert.equal(streamingState.view.messageProjection.activeAssistantId, "assistant-2")
})

test("stale idle snapshots do not remove runtime messages after a finished run", () => {
  const store = createThreadStore()
  const firstTurnMessages = [
    createUserMessage("user-1", "First question"),
    createAssistantMessage("assistant-1", "First answer")
  ]

  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: firstTurnMessages
      },
      runState: {
        contextInclusions: [],
        error: null,
        forkState: { canFork: true },
        pendingApproval: null,
        runId: "run-1",
        todos: [],
        workspacePath: null
      },
      thread: {
        metadata: undefined,
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  store.applyRuntimeEvents("thread-a", [
    {
      message: createUserMessage("user-2", "Second question"),
      revision: 1,
      type: "message.upserted"
    },
    {
      revision: 2,
      run: {
        assistantMessageId: null,
        currentToolCallId: null,
        phase: "thinking",
        phaseStartedAt: new Date("2026-01-01T00:00:00.000Z"),
        runId: "run-2",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "running",
        threadId: "thread-a",
        toolCalls: [],
        turnId: "user-2",
        userMessageId: "user-2"
      },
      type: "run.started"
    },
    {
      completedAt: new Date("2026-01-01T00:00:01.000Z"),
      durationMs: 1_000,
      error: null,
      revision: 3,
      runId: "run-2",
      status: "completed",
      type: "run.finished"
    }
  ])

  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: firstTurnMessages
      },
      runState: {
        contextInclusions: [],
        error: null,
        forkState: { canFork: true },
        pendingApproval: null,
        runId: "run-1",
        todos: [],
        workspacePath: null
      },
      thread: {
        metadata: undefined,
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )

  const state = getThreadState(store, "thread-a")
  assert.equal(state.agent.activeRun, null)
  assert.deepEqual(
    state.view.messageProjection.turns.map((turn) => turn.key),
    ["user-1", "user-2"]
  )
  assert.deepEqual(
    state.agent.messagesPage.map((message) => message.id),
    ["user-1", "assistant-1", "user-2"]
  )

  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: [
          ...firstTurnMessages,
          createUserMessage("user-2", "Second question"),
          createAssistantMessage("assistant-2", "Second answer")
        ]
      },
      runState: {
        contextInclusions: [],
        error: null,
        forkState: { canFork: true },
        pendingApproval: null,
        runId: "run-2",
        todos: [],
        workspacePath: null
      },
      thread: {
        metadata: undefined,
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )

  const caughtUpState = getThreadState(store, "thread-a")
  assert.deepEqual(
    caughtUpState.agent.messagesPage.map((message) => message.id),
    ["user-1", "assistant-1", "user-2", "assistant-2"]
  )
  assert.equal(caughtUpState.view.messageProjection.activeTurnKey, "user-2")
})

test("runtime tool events update source run facts and message projection facts", () => {
  const store = createThreadStore()
  const toolCall = {
    args: {},
    id: "tool-call-1",
    name: "execute",
    type: "tool_call" as const
  }

  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: [
          createUserMessage("user-1", "Run a command"),
          {
            ...createAssistantMessage("assistant-1", ""),
            tool_calls: [toolCall]
          }
        ]
      },
      runState: {
        contextInclusions: [],
        error: null,
        forkState: { canFork: true },
        pendingApproval: null,
        runId: "run-1",
        todos: [],
        workspacePath: null
      },
      thread: {
        metadata: undefined,
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  store.applyRuntimeEvents("thread-a", [
    {
      revision: 1,
      run: {
        assistantMessageId: "assistant-1",
        currentToolCallId: null,
        phase: "tool_running",
        phaseStartedAt: new Date("2026-01-01T00:00:00.000Z"),
        runId: "run-1",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "running",
        threadId: "thread-a",
        toolCalls: [],
        turnId: "user-1",
        userMessageId: "user-1"
      },
      type: "run.started"
    }
  ])

  const initialState = getThreadState(store, "thread-a")
  assert.equal(initialState.agent.activeRun?.status, "running")
  assert.equal(initialState.agent.activeRun?.phase, "tool_running")
  assert.equal(initialState.agent.activeRun?.assistantMessageId, "assistant-1")
  assert.equal(
    initialState.view.messageProjection.turns[0]?.toolResults.get(toolCall.id),
    undefined
  )

  store.applyRuntimeEvents("thread-a", [
    {
      messageId: "assistant-1",
      revision: 2,
      runId: "run-1",
      startedAt: new Date("2026-01-01T00:00:01.000Z"),
      toolCallId: toolCall.id,
      type: "tool.started"
    }
  ])

  const runningState = getThreadState(store, "thread-a")
  assert.equal(runningState.agent.activeRun?.phase, "tool_running")
  assert.equal(runningState.agent.activeRun?.assistantMessageId, "assistant-1")
  assert.equal(
    runningState.view.messageProjection.turns[0]?.toolResults.get(toolCall.id),
    undefined
  )

  store.applyRuntimeEvents("thread-a", [
    {
      message: {
        content: "done",
        created_at: new Date("2026-01-01T00:00:00.000Z"),
        id: "tool-1",
        role: "tool",
        tool_call_id: toolCall.id
      },
      revision: 3,
      type: "message.upserted"
    },
    {
      messageId: "assistant-1",
      completedAt: new Date("2026-01-01T00:00:02.000Z"),
      durationMs: 1_000,
      error: null,
      revision: 4,
      runId: "run-1",
      startedAt: new Date("2026-01-01T00:00:01.000Z"),
      status: "completed",
      toolCallId: toolCall.id,
      toolName: "execute",
      type: "tool.updated"
    }
  ])

  const completedState = getThreadState(store, "thread-a")
  assert.equal(completedState.agent.activeRun?.phase, "thinking")
  const completedTool = completedState.view.messageProjection.turns[0]?.toolResults.get(toolCall.id)
  assert.equal(completedTool?.content, "done")
  assert.equal(completedTool?.execution, null)
})

test("run finished clears active run when no tool result exists", () => {
  const store = createThreadStore()
  const toolCall = {
    args: {},
    id: "tool-call-1",
    name: "execute",
    type: "tool_call" as const
  }

  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: [
          createUserMessage("user-1", "Run a command"),
          {
            ...createAssistantMessage("assistant-1", ""),
            tool_calls: [toolCall]
          }
        ]
      },
      runState: {
        contextInclusions: [],
        error: null,
        forkState: { canFork: true },
        pendingApproval: null,
        runId: "run-1",
        todos: [],
        workspacePath: null
      },
      thread: {
        metadata: undefined,
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  store.applyRuntimeEvents("thread-a", [
    {
      revision: 1,
      run: {
        assistantMessageId: "assistant-1",
        currentToolCallId: null,
        phase: "tool_running",
        phaseStartedAt: new Date("2026-01-01T00:00:00.000Z"),
        runId: "run-1",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "running",
        threadId: "thread-a",
        toolCalls: [],
        turnId: "user-1",
        userMessageId: "user-1"
      },
      type: "run.started"
    }
  ])

  const runningState = getThreadState(store, "thread-a")
  assert.equal(runningState.agent.activeRun?.status, "running")
  assert.equal(runningState.agent.activeRun?.phase, "tool_running")
  assert.equal(
    runningState.view.messageProjection.turns[0]?.toolResults.get(toolCall.id),
    undefined
  )

  store.applyRuntimeEvents("thread-a", [
    {
      completedAt: new Date("2026-01-01T00:00:02.000Z"),
      durationMs: 2_000,
      error: null,
      revision: 2,
      runId: "run-1",
      status: "cancelled",
      type: "run.finished"
    }
  ])

  const finishedState = getThreadState(store, "thread-a")
  assert.equal(finishedState.agent.activeRun, null)
  assert.equal(
    finishedState.view.messageProjection.turns[0]?.toolResults.get(toolCall.id),
    undefined
  )
})

test("pending approval updates source approval facts", () => {
  const store = createThreadStore()
  const toolCall = {
    args: {},
    id: "tool-1",
    name: "bash",
    type: "tool_call" as const
  }
  const pendingApproval = createPendingApproval()
  const snapshotApproval: HITLRequest = {
    ...pendingApproval,
    id: "hitl:thread-a:snapshot:tool-snapshot",
    tool_call: {
      ...pendingApproval.tool_call,
      id: "tool-snapshot"
    }
  }

  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: [
          createUserMessage("user-1", "Run a command"),
          {
            ...createAssistantMessage("assistant-1", ""),
            tool_calls: [toolCall]
          }
        ]
      },
      runState: {
        contextInclusions: [],
        error: null,
        forkState: { canFork: true },
        pendingApproval: null,
        runId: "run-1",
        todos: [],
        workspacePath: null
      },
      thread: {
        metadata: undefined,
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  store.applyRuntimeEvents("thread-a", [
    {
      revision: 1,
      run: {
        assistantMessageId: "assistant-1",
        currentToolCallId: null,
        phase: "tool_running",
        phaseStartedAt: new Date("2026-01-01T00:00:00.000Z"),
        runId: "run-1",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "running",
        threadId: "thread-a",
        toolCalls: [],
        turnId: "user-1",
        userMessageId: "user-1"
      },
      type: "run.started"
    }
  ])
  const runningState = getThreadState(store, "thread-a")
  assert.equal(runningState.agent.activeRun?.status, "running")
  assert.equal(runningState.agent.activeRun?.phase, "tool_running")
  assert.equal(runningState.agent.pendingApproval, null)

  store.applyRuntimeEvents("thread-a", [
    {
      approval: pendingApproval,
      requestedAt: new Date("2026-01-01T00:00:02.000Z"),
      revision: 2,
      runId: "run-1",
      type: "approval.requested"
    }
  ])

  const approvalState = getThreadState(store, "thread-a")
  assert.equal(approvalState.agent.pendingApproval, pendingApproval)
  assert.equal(approvalState.agent.activeRun?.status, "waiting_approval")
  assert.equal(approvalState.agent.activeRun?.phase, "waiting_tool_result")

  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: [
          createUserMessage("user-1", "Run a command"),
          {
            ...createAssistantMessage("assistant-1", ""),
            tool_calls: [toolCall]
          }
        ]
      },
      runState: {
        contextInclusions: [],
        error: null,
        forkState: { canFork: false, reason: "pending_hitl" },
        pendingApproval: snapshotApproval,
        runId: "run-1",
        todos: [],
        workspacePath: null
      },
      thread: {
        metadata: undefined,
        status: "interrupted",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )

  const snapshotApprovalState = getThreadState(store, "thread-a")
  assert.equal(snapshotApprovalState.agent.pendingApproval, pendingApproval)
  assert.equal(snapshotApprovalState.agent.activeRun?.status, "waiting_approval")
  assert.equal(snapshotApprovalState.agent.activeRun?.phase, "waiting_tool_result")
})

test("runtime delta for an unknown message does not advance revision before thread data bootstrap", () => {
  const store = createThreadStore()

  store.applyRuntimeEvents("thread-a", [
    {
      delta: "late",
      deltaAt: new Date("2026-01-01T00:00:01.000Z"),
      field: "text",
      messageId: "assistant-1",
      partId: "content",
      revision: 2,
      type: "message.part.delta"
    }
  ])
  assert.equal(store.getThreadState("thread-a"), null)

  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: [
          createUserMessage("user-1", "Question"),
          createAssistantMessage("assistant-1", "Hello")
        ]
      },
      runState: {
        contextInclusions: [],
        error: null,
        forkState: { canFork: true },
        pendingApproval: null,
        runId: "run-1",
        todos: [],
        workspacePath: null
      },
      thread: {
        metadata: undefined,
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )

  const state = getThreadState(store, "thread-a")
  assert.equal(state.agent.revision, 0)
  assert.equal(state.agent.messagesPage[1]?.content, "Hello")
})

test("runtime token delta keeps historical turn references stable after thread data bootstrap", () => {
  const store = createThreadStore()

  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: [
          createUserMessage("user-1", "Question"),
          createAssistantMessage("assistant-1", "Hello")
        ]
      },
      runState: {
        contextInclusions: [],
        error: null,
        forkState: { canFork: true },
        pendingApproval: null,
        runId: "run-1",
        todos: [],
        workspacePath: null
      },
      thread: {
        metadata: undefined,
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  const firstProjection = getThreadState(store, "thread-a").view.messageProjection
  const firstTurn = firstProjection.turns[0]
  const firstRow = firstProjection.displayRows[0]

  store.applyRuntimeEvents("thread-a", [
    {
      delta: " world",
      deltaAt: new Date("2026-01-01T00:00:01.000Z"),
      field: "text",
      messageId: "assistant-1",
      partId: "content",
      revision: 2,
      type: "message.part.delta"
    }
  ])

  const state = getThreadState(store, "thread-a")
  assert.equal(state.agent.revision, 2)
  assert.equal(state.agent.messagesPage[1]?.content, "Hello world")
  assert.notEqual(state.view.messageProjection, firstProjection)
  assert.notEqual(state.view.messageProjection.turns[0], firstTurn)
  assert.equal(state.view.messageProjection.turns[0]?.user, firstTurn?.user)
  assert.equal(state.view.messageProjection.displayRows[0], firstRow)
  assert.equal(state.view.messageProjection.displayRows.at(-1), firstProjection.displayRows.at(-1))
})

test("runtime token delta in long history keeps inactive turns and rows stable", () => {
  const store = createThreadStore()
  const messages = createLongConversationMessages(200)
  const activeTurnIndex = 199

  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages
      },
      runState: {
        contextInclusions: [],
        error: null,
        forkState: { canFork: true },
        pendingApproval: null,
        runId: "run-1",
        todos: [],
        workspacePath: null
      },
      thread: {
        metadata: undefined,
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  const firstState = getThreadState(store, "thread-a")
  const firstProjection = firstState.view.messageProjection

  store.applyRuntimeEvents("thread-a", [
    {
      delta: " plus streamed token",
      deltaAt: new Date("2026-01-01T00:00:01.000Z"),
      field: "text",
      messageId: `assistant-${activeTurnIndex}`,
      partId: "content",
      revision: 1,
      type: "message.part.delta"
    }
  ])

  const nextState = getThreadState(store, "thread-a")
  assert.equal(
    nextState.agent.messagesPage[activeTurnIndex * 2],
    firstState.agent.messagesPage[activeTurnIndex * 2]
  )
  assert.notEqual(
    nextState.agent.messagesPage[activeTurnIndex * 2 + 1],
    firstState.agent.messagesPage[activeTurnIndex * 2 + 1]
  )
  assert.equal(nextState.view.messageProjection.displayRows, firstProjection.displayRows)
  for (let index = 0; index < activeTurnIndex; index += 1) {
    assert.equal(nextState.view.messageProjection.turns[index], firstProjection.turns[index])
    assert.equal(
      nextState.view.messageProjection.displayRows[index],
      firstProjection.displayRows[index]
    )
  }
  assert.notEqual(
    nextState.view.messageProjection.turns[activeTurnIndex],
    firstProjection.turns[activeTurnIndex]
  )
  assert.equal(nextState.view.messageProjection.activeTurnKey, `user-${activeTurnIndex}`)
  assert.equal(nextState.view.messageProjection.activeAssistantId, `assistant-${activeTurnIndex}`)
})

test("thread data snapshot restores non-runtime facts and stale events do not roll back runtime facts", () => {
  const store = createThreadStore()
  const pendingApproval = createPendingApproval()

  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: [createUserMessage("user-1", "Question")]
      },
      runState: {
        contextInclusions: [],
        error: "Needs approval",
        forkState: { canFork: false, reason: "pending_hitl" },
        pendingApproval,
        runId: "run-1",
        todos: [
          {
            content: "Snapshot todo",
            id: "snapshot-todo",
            status: "pending"
          }
        ],
        workspacePath: null
      },
      thread: {
        metadata: undefined,
        status: "interrupted",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  store.applyRuntimeEvents("thread-a", [
    {
      message: createUserMessage("user-1", "Question"),
      revision: 1,
      type: "message.upserted"
    },
    {
      revision: 2,
      run: {
        assistantMessageId: null,
        currentToolCallId: null,
        phase: "thinking",
        phaseStartedAt: new Date("2026-01-01T00:00:00.000Z"),
        runId: "run-1",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "running",
        threadId: "thread-a",
        toolCalls: [],
        turnId: "user-1",
        userMessageId: "user-1"
      },
      type: "run.resumed"
    },
    {
      approval: pendingApproval,
      requestedAt: new Date("2026-01-01T00:00:02.000Z"),
      revision: 3,
      runId: "run-1",
      type: "approval.requested"
    },
    {
      revision: 4,
      todos: [
        {
          content: "Review command",
          id: "todo-1",
          status: "pending"
        }
      ],
      type: "todos.replaced"
    },
    {
      revision: 5,
      tokenUsage: {
        inputTokens: 10,
        lastUpdated: "2026-01-01T00:00:00.000Z",
        outputTokens: 5,
        totalTokens: 15
      },
      type: "run.tokenUsageUpdated"
    },
    {
      completedAt: new Date("2026-01-01T00:00:02.000Z"),
      durationMs: 2_000,
      error: null,
      revision: 1,
      runId: "run-1",
      status: "completed",
      type: "run.finished"
    }
  ])

  const state = getThreadState(store, "thread-a")
  assert.equal(state.agent.revision, 5)
  assert.equal(state.agent.latestRunId, "run-1")
  assert.equal(state.agent.error, null)
  assert.equal(state.agent.pendingApproval, pendingApproval)
  assert.equal(state.agent.todos[0]?.id, "todo-1")
  assert.equal(state.agent.tokenUsage?.totalTokens, 15)
  assert.equal(state.agent.activeRun?.status, "waiting_approval")
})
