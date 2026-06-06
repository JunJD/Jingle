import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_PERMISSION_MODE } from "../../src/shared/permission-mode"
import type { ActiveAgentRun } from "../../src/shared/agent-thread-runtime"
import type { AgentThreadDataSnapshot } from "../../src/shared/app-types"
import type { HITLRequest } from "../../src/shared/hitl"
import type { ArtifactRecord } from "../../src/shared/artifacts"
import { createThreadStore } from "../../src/renderer/src/lib/thread-store-core"
import type { Message } from "../../src/renderer/src/types"

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

function createActiveRun(): ActiveAgentRun {
  return {
    assistantMessageId: null,
    phase: "thinking",
    runId: null,
    status: "running",
    threadId: "thread-a",
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
      error: null,
      forkState: { canFork: true },
      pendingApproval: null,
      runId: null,
      todos: []
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

test("thread subscriptions stay scoped to the matching thread id", () => {
  const store = createThreadStore()
  let threadACalls = 0
  let allThreadCalls = 0

  const unsubscribeThread = store.subscribeThread("thread-a", () => {
    threadACalls += 1
  })
  const unsubscribeAll = store.subscribeAllThreadStates(() => {
    allThreadCalls += 1
  })

  store.ensureThreadState("thread-a")
  store.ensureThreadState("thread-b")
  store.getThreadActions("thread-a").setDraftInput("hello")

  unsubscribeThread()
  unsubscribeAll()

  assert.equal(threadACalls, 2)
  assert.equal(allThreadCalls, 3)
  assert.equal(store.getThreadRecord("thread-a").draftInput, "hello")
  assert.equal(store.getThreadRecord("thread-b").draftInput, "")
  assert.equal(store.getThreadRecord("thread-b").permissionMode, DEFAULT_PERMISSION_MODE)
})

test("setCurrentModel updates state and runs the injected persistence effect", () => {
  const persisted: Array<{ modelId: string; threadId: string }> = []
  const store = createThreadStore({
    persistCurrentModel: (threadId, modelId) => {
      persisted.push({ modelId, threadId })
    }
  })

  store.getThreadActions("thread-a").setCurrentModel("gpt-test")

  assert.equal(store.getThreadState("thread-a").currentModel, "gpt-test")
  assert.deepEqual(persisted, [{ modelId: "gpt-test", threadId: "thread-a" }])
})

test("setPermissionMode updates state and runs the injected persistence effect", () => {
  const persisted: Array<{ permissionMode: string; threadId: string }> = []
  const store = createThreadStore({
    persistPermissionMode: (threadId, permissionMode) => {
      persisted.push({ permissionMode, threadId })
    }
  })

  store.getThreadActions("thread-a").setPermissionMode("auto")

  assert.equal(store.getThreadState("thread-a").permissionMode, "auto")
  assert.deepEqual(persisted, [{ permissionMode: "auto", threadId: "thread-a" }])
})

test("setArtifacts refreshes metadata for already open artifact tabs", () => {
  const store = createThreadStore()
  const actions = store.getThreadActions("thread-a")

  actions.openArtifactTab({
    artifactId: "artifact-1",
    kind: "summary",
    title: "Old summary"
  })
  actions.setArtifacts([
    createLinkArtifact({
      id: "artifact-1",
      threadId: "thread-a",
      title: "Published link",
      toolCallId: "tool-call-1"
    })
  ])

  assert.deepEqual(store.getThreadState("thread-a").openArtifacts, [
    {
      artifactId: "artifact-1",
      kind: "link",
      title: "Published link"
    }
  ])
})

test("stream loading subscriptions only fire when the value actually changes", () => {
  const store = createThreadStore()
  let callCount = 0

  const unsubscribe = store.subscribeAllStreamLoadingStates(() => {
    callCount += 1
  })

  store.setStreamLoadingState("thread-a", true)
  store.setStreamLoadingState("thread-a", true)
  store.setStreamLoadingState("thread-a", false)
  unsubscribe()
  store.setStreamLoadingState("thread-a", true)

  assert.equal(callCount, 2)
  assert.equal(store.getStreamLoadingState("thread-a"), true)
})

test("message actions update projection without emitting for equivalent snapshots", () => {
  const store = createThreadStore()
  const actions = store.getThreadActions("thread-a")
  let calls = 0

  const unsubscribe = store.subscribeThread("thread-a", () => {
    calls += 1
  })
  const messages = [createUserMessage("user-1"), createAssistantMessage("assistant-1", "Hello")]

  actions.setMessages(messages)
  const firstProjection = store.getThreadState("thread-a").messageProjection
  actions.setMessages(structuredClone(messages))
  const equivalentProjection = store.getThreadState("thread-a").messageProjection
  actions.appendMessage(createAssistantMessage("assistant-1", "Hello again"))
  const updatedProjection = store.getThreadState("thread-a").messageProjection
  unsubscribe()

  assert.equal(calls, 2)
  assert.equal(equivalentProjection, firstProjection)
  assert.notEqual(updatedProjection, firstProjection)
  assert.equal(updatedProjection.turns[0]?.user, firstProjection.turns[0]?.user)
  assert.equal(updatedProjection.turns[0]?.assistants[0]?.content, "Hello again")
})

test("message projection uses runtime-owned active turn from thread state", () => {
  const store = createThreadStore()

  store.updateThreadState("thread-a", () => ({
    activeRun: {
      assistantMessageId: null,
      phase: "thinking",
      runId: "run-1",
      status: "running",
      threadId: "thread-a",
      turnId: "user-2",
      userMessageId: "user-2"
    }
  }))
  store.getThreadActions("thread-a").setMessages([
    createUserMessage("user-1", "First question"),
    createAssistantMessage("assistant-1", "First answer"),
    createUserMessage("user-2", "Second question")
  ])

  const state = store.getThreadState("thread-a")
  assert.equal(state.messageProjection.activeTurnKey, "user-2")
  assert.equal(state.messageProjection.activeAssistantId, null)
})

test("thread data snapshot and events update thread state through store reducer", () => {
  const store = createThreadStore()
  const actions = store.getThreadActions("thread-a")
  const activeRun = createActiveRun()
  const artifact = createLinkArtifact({
    id: "artifact-1",
    threadId: "thread-a",
    title: "Published link",
    toolCallId: "tool-call-1"
  })

  actions.applyThreadDataSnapshot(
    createThreadDataSnapshot({
      messages: {
        artifacts: [artifact],
        messages: [createUserMessage("user-1", "Question")]
      },
      runState: {
        error: null,
        forkState: { canFork: false, reason: "busy" },
        pendingApproval: null,
        runId: activeRun.runId,
        todos: []
      },
      thread: {
        metadata: {
          model: "openai:gpt-4o",
          permissionMode: "auto",
          workspacePath: "/tmp/launcher-ai-first-send"
        },
        status: "busy",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  actions.applyRuntimeEvents([
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

  const state = store.getThreadState("thread-a")
  assert.equal(state.revision, 3)
  assert.equal(state.runId, "run-1")
  assert.equal(state.activeRun?.assistantMessageId, "assistant-1")
  assert.deepEqual(state.artifacts, [artifact])
  assert.deepEqual(state.forkState, { canFork: false, reason: "busy" })
  assert.equal(state.workspacePath, "/tmp/launcher-ai-first-send")
  assert.equal(state.currentModel, "openai:gpt-4o")
  assert.equal(state.permissionMode, "auto")
  assert.equal(state.messageProjection.activeTurnKey, "user-1")
  assert.deepEqual(
    state.messages.map((message) => message.id),
    ["user-1", "assistant-1"]
  )
})

test("run started immediately moves projection active turn before assistant first token", () => {
  const store = createThreadStore()
  const actions = store.getThreadActions("thread-a")

  actions.applyThreadDataSnapshot(
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: [
          createUserMessage("user-1", "First question"),
          createAssistantMessage("assistant-1", "First answer")
        ]
      },
      runState: {
        error: null,
        forkState: { canFork: true },
        pendingApproval: null,
        runId: null,
        todos: [],
      },
      thread: {
        metadata: undefined,
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  const firstProjection = store.getThreadState("thread-a").messageProjection
  assert.equal(firstProjection.activeTurnKey, "user-1")

  actions.applyRuntimeEvents([
    {
      message: createUserMessage("user-2", "Second question"),
      revision: 1,
      type: "message.upserted"
    },
    {
      revision: 2,
      run: {
        assistantMessageId: null,
        phase: "thinking",
        runId: null,
        status: "running",
        threadId: "thread-a",
        turnId: "user-2",
        userMessageId: "user-2"
      },
      type: "run.started"
    }
  ])

  const state = store.getThreadState("thread-a")
  assert.equal(state.activeRun?.turnId, "user-2")
  assert.equal(state.messageProjection.activeTurnKey, "user-2")
  assert.equal(state.messageProjection.activeAssistantId, null)

  actions.applyRuntimeEvents([
    {
      message: createAssistantMessage("assistant-2", "Streaming"),
      revision: 3,
      type: "message.upserted"
    }
  ])

  const streamingState = store.getThreadState("thread-a")
  assert.equal(streamingState.activeRun?.assistantMessageId, "assistant-2")
  assert.equal(streamingState.messageProjection.activeTurnKey, "user-2")
  assert.equal(streamingState.messageProjection.activeAssistantId, "assistant-2")
})

test("runtime delta for an unknown message does not advance revision before thread data bootstrap", () => {
  const store = createThreadStore()
  const actions = store.getThreadActions("thread-a")

  actions.applyRuntimeEvents([
    {
      delta: "late",
      field: "text",
      messageId: "assistant-1",
      partId: "content",
      revision: 2,
      type: "message.part.delta"
    }
  ])
  assert.equal(store.getThreadState("thread-a").revision, 0)

  actions.applyThreadDataSnapshot(
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: [
          createUserMessage("user-1", "Question"),
          createAssistantMessage("assistant-1", "Hello")
        ]
      },
      runState: {
        error: null,
        forkState: { canFork: false, reason: "busy" },
        pendingApproval: null,
        runId: "run-1",
        todos: []
      },
      thread: {
        metadata: undefined,
        status: "busy",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )

  const state = store.getThreadState("thread-a")
  assert.equal(state.revision, 0)
  assert.equal(state.messages[1]?.content, "Hello")
})

test("runtime token delta keeps historical turn references stable after thread data bootstrap", () => {
  const store = createThreadStore()
  const actions = store.getThreadActions("thread-a")

  actions.applyThreadDataSnapshot(
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: [
          createUserMessage("user-1", "Question"),
          createAssistantMessage("assistant-1", "Hello")
        ]
      },
      runState: {
        error: null,
        forkState: { canFork: false, reason: "busy" },
        pendingApproval: null,
        runId: "run-1",
        todos: []
      },
      thread: {
        metadata: undefined,
        status: "busy",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  const firstProjection = store.getThreadState("thread-a").messageProjection
  const firstTurn = firstProjection.turns[0]
  const firstRow = firstProjection.displayRows[0]

  actions.applyRuntimeEvents([
    {
      delta: " world",
      field: "text",
      messageId: "assistant-1",
      partId: "content",
      revision: 2,
      type: "message.part.delta"
    }
  ])

  const state = store.getThreadState("thread-a")
  assert.equal(state.revision, 2)
  assert.equal(state.messages[1]?.content, "Hello world")
  assert.notEqual(state.messageProjection, firstProjection)
  assert.notEqual(state.messageProjection.turns[0], firstTurn)
  assert.equal(state.messageProjection.turns[0]?.user, firstTurn?.user)
  assert.notEqual(state.messageProjection.displayRows[0], firstRow)
  assert.equal(state.messageProjection.displayRows.at(-1), firstProjection.displayRows.at(-1))
})

test("thread data snapshot restores thread facts and stale events do not roll back state", () => {
  const store = createThreadStore()
  const actions = store.getThreadActions("thread-a")
  const pendingApproval = createPendingApproval()

  actions.applyThreadDataSnapshot(
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: [createUserMessage("user-1", "Question")]
      },
      runState: {
        error: "Needs approval",
        forkState: { canFork: false, reason: "pending_hitl" },
        pendingApproval,
        runId: "run-1",
        todos: [
          {
            content: "Review command",
            id: "todo-1",
            status: "pending"
          }
        ]
      },
      thread: {
        metadata: undefined,
        status: "interrupted",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  actions.applyRuntimeEvents([
    {
      revision: 1,
      subagents: [
        {
          description: "Review code",
          id: "subagent-1",
          name: "Reviewer",
          status: "running"
        }
      ],
      type: "subagents.replaced"
    },
    {
      revision: 2,
      tokenUsage: {
        inputTokens: 10,
        lastUpdated: new Date("2026-01-01T00:00:00.000Z"),
        outputTokens: 5,
        totalTokens: 15
      },
      type: "run.tokenUsageUpdated"
    },
    {
      revision: 1,
      runId: "run-1",
      status: "completed",
      type: "run.finished"
    }
  ])

  const state = store.getThreadState("thread-a")
  assert.equal(state.revision, 2)
  assert.equal(state.runId, "run-1")
  assert.equal(state.error, "Needs approval")
  assert.equal(state.pendingApproval, pendingApproval)
  assert.equal(state.subagents[0]?.id, "subagent-1")
  assert.equal(state.todos[0]?.id, "todo-1")
  assert.equal(state.tokenUsage?.totalTokens, 15)
  assert.equal(state.activeRun?.status, "waiting_approval")
})
