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
  assert.equal(store.getThreadState("thread-a").ui.draftInput, "hello")
  assert.equal(store.getThreadState("thread-b").ui.draftInput, "")
  assert.equal(store.getThreadState("thread-b").agent.permissionMode, DEFAULT_PERMISSION_MODE)
})

test("setCurrentModel updates state and runs the injected persistence effect", () => {
  const persisted: Array<{ modelId: string; threadId: string }> = []
  const store = createThreadStore({
    persistCurrentModel: (threadId, modelId) => {
      persisted.push({ modelId, threadId })
    }
  })

  store.getThreadActions("thread-a").setCurrentModel("gpt-test")

  assert.equal(store.getThreadState("thread-a").agent.currentModel, "gpt-test")
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

  assert.equal(store.getThreadState("thread-a").agent.permissionMode, "auto")
  assert.deepEqual(persisted, [{ permissionMode: "auto", threadId: "thread-a" }])
})

test("artifact changed events refresh metadata for already open artifact tabs", () => {
  const store = createThreadStore()
  const actions = store.getThreadActions("thread-a")

  actions.openArtifactTab({
    artifactId: "artifact-1",
    kind: "summary",
    title: "Old summary"
  })
  store.applyArtifactsChanged("thread-a", [
    createLinkArtifact({
      id: "artifact-1",
      threadId: "thread-a",
      title: "Published link",
      toolCallId: "tool-call-1"
    })
  ])

  assert.deepEqual(store.getThreadState("thread-a").ui.openArtifacts, [
    {
      artifactId: "artifact-1",
      kind: "link",
      title: "Published link"
    }
  ])
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
  const firstProjection = store.getThreadState("thread-a").view.messageProjection
  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      messages: {
        artifacts: [],
        messages: structuredClone(messages)
      }
    })
  )
  const equivalentProjection = store.getThreadState("thread-a").view.messageProjection
  store.applyRuntimeEvents("thread-a", [
    {
      message: createAssistantMessage("assistant-1", "Hello again"),
      revision: 1,
      type: "message.upserted"
    }
  ])
  const updatedProjection = store.getThreadState("thread-a").view.messageProjection
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
        phase: "thinking",
        runId: "run-1",
        status: "running",
        threadId: "thread-a",
        turnId: "user-2",
        userMessageId: "user-2"
      },
      type: "run.started"
    }
  ])

  const state = store.getThreadState("thread-a")
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
  store.applyRuntimeEvents("thread-a", [
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
  assert.equal(state.agent.revision, 3)
  assert.equal(state.agent.runId, "run-1")
  assert.equal(state.agent.activeRun?.assistantMessageId, "assistant-1")
  assert.deepEqual(state.agent.artifacts, [artifact])
  assert.deepEqual(state.agent.forkState, { canFork: false, reason: "busy" })
  assert.equal(state.agent.workspacePath, "/tmp/launcher-ai-first-send")
  assert.equal(state.agent.currentModel, "openai:gpt-4o")
  assert.equal(state.agent.permissionMode, "auto")
  assert.equal(state.view.messageProjection.activeTurnKey, "user-1")
  assert.deepEqual(
    state.agent.messages.map((message) => message.id),
    ["user-1", "assistant-1"]
  )
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
        error: null,
        forkState: { canFork: true },
        pendingApproval: null,
        runId: null,
        todos: []
      },
      thread: {
        metadata: undefined,
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  const firstProjection = store.getThreadState("thread-a").view.messageProjection
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

  const streamingState = store.getThreadState("thread-a")
  assert.equal(streamingState.agent.activeRun?.assistantMessageId, "assistant-2")
  assert.equal(streamingState.view.messageProjection.activeTurnKey, "user-2")
  assert.equal(streamingState.view.messageProjection.activeAssistantId, "assistant-2")
})

test("runtime messages derive tool execution view facts", () => {
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

  assert.equal(
    store.getThreadState("thread-a").view.messageProjection.turns[0]?.toolResults.get(toolCall.id),
    undefined
  )
  assert.deepEqual(store.getThreadState("thread-a").view.toolExecutions[toolCall.id], {
    status: "running",
    toolCallId: toolCall.id
  })

  store.applyRuntimeEvents("thread-a", [
    {
      messageId: "assistant-1",
      revision: 1,
      runId: "run-1",
      toolCallId: toolCall.id,
      type: "tool.started"
    }
  ])

  const runningState = store.getThreadState("thread-a")
  assert.deepEqual(runningState.view.toolExecutions[toolCall.id], {
    status: "running",
    toolCallId: toolCall.id
  })
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
      revision: 2,
      type: "message.upserted"
    },
    {
      messageId: "assistant-1",
      revision: 3,
      runId: "run-1",
      toolCallId: toolCall.id,
      type: "tool.updated"
    }
  ])

  const completedState = store.getThreadState("thread-a")
  assert.deepEqual(completedState.view.toolExecutions[toolCall.id], {
    status: "complete",
    toolCallId: toolCall.id
  })
  const completedTool = completedState.view.messageProjection.turns[0]?.toolResults.get(toolCall.id)
  assert.equal(completedTool?.content, "done")
})

test("run finished clears running tool execution view when no tool result exists", () => {
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

  assert.deepEqual(store.getThreadState("thread-a").view.toolExecutions[toolCall.id], {
    status: "running",
    toolCallId: toolCall.id
  })

  store.applyRuntimeEvents("thread-a", [
    {
      revision: 1,
      runId: "run-1",
      status: "cancelled",
      type: "run.finished"
    }
  ])

  const finishedState = store.getThreadState("thread-a")
  assert.equal(finishedState.agent.activeRun, null)
  assert.equal(finishedState.view.toolExecutions[toolCall.id], undefined)
})

test("pending approval overrides existing tool execution view without duplicate entries", () => {
  const store = createThreadStore()
  const toolCall = {
    args: {},
    id: "tool-1",
    name: "bash",
    type: "tool_call" as const
  }
  const pendingApproval = createPendingApproval()

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
  const runningToolExecutions = store.getThreadState("thread-a").view.toolExecutions
  assert.deepEqual(runningToolExecutions[toolCall.id], {
    status: "running",
    toolCallId: toolCall.id
  })

  store.applyRuntimeEvents("thread-a", [
    {
      approval: pendingApproval,
      revision: 1,
      runId: "run-1",
      type: "approval.requested"
    }
  ])

  const approvalToolExecutions = store.getThreadState("thread-a").view.toolExecutions
  assert.deepEqual(Object.keys(approvalToolExecutions), [toolCall.id])
  assert.deepEqual(approvalToolExecutions[toolCall.id], {
    status: "approval",
    toolCallId: toolCall.id
  })

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
        error: null,
        forkState: { canFork: false, reason: "pending_hitl" },
        pendingApproval,
        runId: "run-1",
        todos: []
      },
      thread: {
        metadata: undefined,
        status: "interrupted",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )

  assert.equal(store.getThreadState("thread-a").view.toolExecutions, approvalToolExecutions)
})

test("runtime delta for an unknown message does not advance revision before thread data bootstrap", () => {
  const store = createThreadStore()

  store.applyRuntimeEvents("thread-a", [
    {
      delta: "late",
      field: "text",
      messageId: "assistant-1",
      partId: "content",
      revision: 2,
      type: "message.part.delta"
    }
  ])
  assert.equal(store.getThreadState("thread-a").agent.revision, 0)

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
  assert.equal(state.agent.revision, 0)
  assert.equal(state.agent.messages[1]?.content, "Hello")
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
  const firstProjection = store.getThreadState("thread-a").view.messageProjection
  const firstTurn = firstProjection.turns[0]
  const firstRow = firstProjection.displayRows[0]

  store.applyRuntimeEvents("thread-a", [
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
  assert.equal(state.agent.revision, 2)
  assert.equal(state.agent.messages[1]?.content, "Hello world")
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
  const firstState = store.getThreadState("thread-a")
  const firstProjection = firstState.view.messageProjection
  const firstToolExecutionsView = firstState.view.toolExecutions

  store.applyRuntimeEvents("thread-a", [
    {
      delta: " plus streamed token",
      field: "text",
      messageId: `assistant-${activeTurnIndex}`,
      partId: "content",
      revision: 1,
      type: "message.part.delta"
    }
  ])

  const nextState = store.getThreadState("thread-a")
  assert.equal(nextState.agent.messages[activeTurnIndex * 2], firstState.agent.messages[activeTurnIndex * 2])
  assert.notEqual(
    nextState.agent.messages[activeTurnIndex * 2 + 1],
    firstState.agent.messages[activeTurnIndex * 2 + 1]
  )
  assert.equal(nextState.view.messageProjection.displayRows, firstProjection.displayRows)
  assert.equal(nextState.view.toolExecutions, firstToolExecutionsView)
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

test("thread data snapshot restores thread facts and stale events do not roll back state", () => {
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
  store.applyRuntimeEvents("thread-a", [
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
  assert.equal(state.agent.revision, 2)
  assert.equal(state.agent.runId, "run-1")
  assert.equal(state.agent.error, "Needs approval")
  assert.equal(state.agent.pendingApproval, pendingApproval)
  assert.equal(state.agent.subagents[0]?.id, "subagent-1")
  assert.equal(state.agent.todos[0]?.id, "todo-1")
  assert.equal(state.agent.tokenUsage?.totalTokens, 15)
  assert.equal(state.agent.activeRun?.status, "waiting_approval")
})
