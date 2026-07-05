import assert from "node:assert/strict"
import test from "node:test"
import type { AgentThreadEvent } from "../../src/shared/agent-thread-contract"
import type {
  JingleAgentRuntimeReplayOptions,
  JingleRuntimeEventBatch
} from "@jingle/agent-client"
import type { AgentThreadDataSnapshot } from "../../src/shared/app-types"
import type { HITLRequest } from "../../src/shared/hitl"
import type { AgentContextInclusion } from "../../src/shared/jingle-memory"
import { createAgentRuntimeManager } from "../../src/renderer/src/lib/agent-runtime-manager"
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

function createPendingApproval(): HITLRequest {
  return {
    allowed_decisions: ["approve", "reject"],
    id: "hitl:thread-a:run-a:tool-a",
    review: null,
    tool_call: {
      args: {},
      id: "tool-a",
      name: "bash",
      type: "tool_call" as const
    }
  }
}

function createThreadDataSnapshot(input: {
  contextInclusions?: AgentContextInclusion[]
  metadata?: Record<string, unknown>
  messages: Message[]
  pendingApproval?: AgentThreadDataSnapshot["runState"]["pendingApproval"]
  status?: AgentThreadDataSnapshot["thread"]["status"]
  workspacePath?: string | null
}): AgentThreadDataSnapshot {
  return {
    messages: {
      artifacts: [],
      messages: input.messages
    },
    runState: {
      contextInclusions: input.contextInclusions ?? [],
      error: null,
      forkState: { canFork: true },
      pendingApproval: input.pendingApproval ?? null,
      runId: null,
      todos: [],
      workspacePath: input.workspacePath ?? null
    },
    thread: {
      metadata: input.metadata,
      status: input.status ?? "idle",
      thread_id: "thread-a",
      title: undefined
    }
  }
}

function createContextInclusion(runId = "run-a"): AgentContextInclusion {
  return {
    availability: "available",
    createdAt: 123,
    id: `ctx:${runId}:retrieved:history_message:thread-history:message-history`,
    messageId: null,
    mode: "retrieved",
    preview: "Earlier context",
    runId,
    sourceId: "message-history",
    sourceType: "history_message",
    target: {
      messageId: "message-history",
      threadId: "thread-history",
      type: "history_message"
    },
    threadId: "thread-a",
    title: "assistant message",
    turnId: null
  }
}

function installWindowApiStub(input: {
  getAgentThreadData?: (threadId: string) => Promise<AgentThreadDataSnapshot>
  onConnect?: (
    callback: (batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void,
    options?: JingleAgentRuntimeReplayOptions
  ) => void
  onReplayThreadEvents?: (
    threadId: string,
    options?: JingleAgentRuntimeReplayOptions
  ) => Promise<void> | void
}): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      api: {
        agent: {
          connectThreadEvents: (
            _threadId: string,
            callback: (batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void,
            options?: JingleAgentRuntimeReplayOptions
          ) => {
            input.onConnect?.(callback, options)
            return Object.assign(() => {}, {
              ready: Promise.resolve()
            })
          },
          replayThreadEvents: async (threadId: string, options?: JingleAgentRuntimeReplayOptions) => {
            await input.onReplayThreadEvents?.(threadId, options)
          }
        },
        threads: {
          getAgentThreadData:
            input.getAgentThreadData ??
            (async () =>
              createThreadDataSnapshot({
                messages: []
              }))
        }
      }
    }
  })
}

test("agent runtime manager applies connected runtime batches into thread state", async () => {
  const connection: {
    listener: ((batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void) | null
  } = {
    listener: null
  }
  installWindowApiStub({
    onConnect: (callback) => {
      connection.listener = callback
    }
  })
  const store = createThreadStore()
  const manager = createAgentRuntimeManager({ threadStore: store })

  await manager.awaitThreadRuntime("thread-a")
  const connectedListener = connection.listener
  assert.ok(connectedListener)

  connectedListener({
    events: [
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
      }
    ],
    latestRevision: 2,
    threadId: "thread-a"
  })

  const state = getThreadState(store, "thread-a")
  assert.equal(state.agent.activeRun?.status, "running")
  assert.equal(state.view.messageProjection.activeTurnKey, "user-1")
  assert.deepEqual(
    state.agent.messagesPage.map((message) => message.id),
    ["user-1"]
  )
})

test("agent runtime manager keeps runtime error facts unformatted", async () => {
  const connection: {
    listener: ((batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void) | null
  } = {
    listener: null
  }
  installWindowApiStub({
    onConnect: (callback) => {
      connection.listener = callback
    }
  })
  const store = createThreadStore()
  const manager = createAgentRuntimeManager({ threadStore: store })

  await manager.awaitThreadRuntime("thread-a")
  const connectedListener = connection.listener
  assert.ok(connectedListener)

  connectedListener({
    events: [
      {
        error: {
          code: "INTERNAL",
          message: "prompt is too long: 120000 tokens > 64000 maximum",
          status: 500
        },
        revision: 1,
        status: "error",
        type: "thread.statusChanged"
      }
    ],
    latestRevision: 1,
    threadId: "thread-a"
  })

  const state = getThreadState(store, "thread-a")
  assert.equal(state.agent.error?.message, "prompt is too long: 120000 tokens > 64000 maximum")
})

test("agent runtime manager loads thread snapshot through its runtime boundary", async () => {
  installWindowApiStub({
    getAgentThreadData: async () =>
      createThreadDataSnapshot({
        messages: [
          createUserMessage("user-1", "Question"),
          createAssistantMessage("assistant-1", "Answer")
        ]
      })
  })
  const store = createThreadStore()
  const manager = createAgentRuntimeManager({ threadStore: store })

  await manager.loadThreadData("thread-a")

  const state = getThreadState(store, "thread-a")
  assert.deepEqual(
    state.agent.messagesPage.map((message) => message.id),
    ["user-1", "assistant-1"]
  )
  assert.equal(state.view.messageProjection.turns.length, 1)
})

test("agent runtime manager refreshes thread data after a run finishes", async () => {
  const connection: {
    listener: ((batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void) | null
  } = {
    listener: null
  }
  installWindowApiStub({
    getAgentThreadData: async () =>
      createThreadDataSnapshot({
        messages: [
          createUserMessage("user-1", "Question"),
          createAssistantMessage("assistant-1", "Answer")
        ]
      }),
    onConnect: (callback) => {
      connection.listener = callback
    }
  })
  const store = createThreadStore()
  const manager = createAgentRuntimeManager({ threadStore: store })

  await manager.awaitThreadRuntime("thread-a")
  const connectedListener = connection.listener
  assert.ok(connectedListener)

  connectedListener({
    events: [
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
          runId: "run-a",
          startedAt: new Date("2026-01-01T00:00:00.000Z"),
          status: "running",
          threadId: "thread-a",
          toolCalls: [],
          turnId: "user-1",
          userMessageId: "user-1"
        },
        type: "run.started"
      }
    ],
    latestRevision: 2,
    threadId: "thread-a"
  })
  connectedListener({
    events: [
      {
        completedAt: new Date("2026-01-01T00:00:02.000Z"),
        durationMs: 2_000,
        error: null,
        revision: 3,
        runId: "run-a",
        status: "completed",
        type: "run.finished"
      }
    ],
    latestRevision: 3,
    threadId: "thread-a"
  })
  await new Promise((resolve) => setImmediate(resolve))

  const state = getThreadState(store, "thread-a")
  assert.deepEqual(
    state.agent.messagesPage.map((message) => message.id),
    ["user-1", "assistant-1"]
  )
})

test("agent runtime manager hydrates message-bound context evidence from thread snapshots", async () => {
  const contextInclusion = {
    ...createContextInclusion(),
    messageId: "assistant-1",
    turnId: "user-1"
  }
  installWindowApiStub({
    getAgentThreadData: async () =>
      createThreadDataSnapshot({
        contextInclusions: [contextInclusion],
        messages: [
          createUserMessage("user-1", "Question with restored evidence"),
          createAssistantMessage("assistant-1", "Answer with restored evidence")
        ]
      })
  })
  const store = createThreadStore()
  const manager = createAgentRuntimeManager({ threadStore: store })

  await manager.loadThreadData("thread-a")

  const state = getThreadState(store, "thread-a")
  assert.equal(state.agent.contextInclusions[0]?.id, contextInclusion.id)
  assert.equal(state.agent.contextInclusions[0]?.turnId, "user-1")
  assert.equal(state.agent.contextInclusions[0]?.messageId, "assistant-1")
  assert.deepEqual(
    state.view.messageProjection.turns.map((turn) => turn.key),
    ["user-1"]
  )
})

test("agent runtime manager replays runtime events instead of applying snapshot content while streaming", async () => {
  const replayedThreadIds: string[] = []
  const replayOptions: Array<JingleAgentRuntimeReplayOptions | undefined> = []
  let snapshotLoadCount = 0
  installWindowApiStub({
    getAgentThreadData: async () => {
      snapshotLoadCount += 1
      return createThreadDataSnapshot({
        messages: []
      })
    },
    onReplayThreadEvents: (threadId, options) => {
      replayedThreadIds.push(threadId)
      replayOptions.push(options)
    }
  })
  const store = createThreadStore()
  const manager = createAgentRuntimeManager({ threadStore: store })

  await manager.awaitThreadRuntime("thread-a")
  store.applyRuntimeEvents("thread-a", [
    {
      message: createUserMessage("user-1", "Question from runtime"),
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
        runId: "run-a",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "running",
        threadId: "thread-a",
        toolCalls: [],
        turnId: "turn-a",
        userMessageId: "user-1"
      },
      type: "run.started"
    }
  ])

  await manager.loadThreadData("thread-a")

  const state = getThreadState(store, "thread-a")
  assert.equal(state.agent.activeRun?.status, "running")
  assert.deepEqual(replayedThreadIds, ["thread-a"])
  assert.deepEqual(replayOptions, [{ fromRevision: 2 }])
  assert.equal(snapshotLoadCount, 1)
  assert.deepEqual(
    state.agent.messagesPage.map((message) => message.content),
    ["Question from runtime"]
  )
})

test("agent runtime manager applies metadata snapshots while streaming before replaying events", async () => {
  const replayedThreadIds: string[] = []
  let snapshotLoadCount = 0
  installWindowApiStub({
    getAgentThreadData: async () => {
      snapshotLoadCount += 1
      return createThreadDataSnapshot({
        metadata: {
          model: "openai:gpt-4o"
        },
        messages: [
          createUserMessage("snapshot-user", "Snapshot should not replace runtime messages")
        ],
        status: "busy",
        workspacePath: "/tmp/streaming"
      })
    },
    onReplayThreadEvents: (threadId) => {
      replayedThreadIds.push(threadId)
    }
  })
  const store = createThreadStore()
  const manager = createAgentRuntimeManager({ threadStore: store })

  await manager.awaitThreadRuntime("thread-a")
  store.applyRuntimeEvents("thread-a", [
    {
      message: createUserMessage("user-1", "Question from runtime"),
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
        runId: "run-a",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "running",
        threadId: "thread-a",
        toolCalls: [],
        turnId: "turn-a",
        userMessageId: "user-1"
      },
      type: "run.started"
    }
  ])

  await manager.loadThreadData("thread-a")

  const state = getThreadState(store, "thread-a")
  assert.equal(snapshotLoadCount, 1)
  assert.deepEqual(replayedThreadIds, ["thread-a"])
  assert.equal(state.agent.currentModel, "openai:gpt-4o")
  assert.equal(state.agent.workspacePath, "/tmp/streaming")
  assert.equal(state.agent.activeRun?.status, "running")
  assert.deepEqual(
    state.agent.messagesPage.map((message) => message.content),
    ["Question from runtime"]
  )
})

test("agent runtime manager replays events instead of applying busy snapshots", async () => {
  const connection: {
    listener: ((batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void) | null
  } = {
    listener: null
  }
  const replayedThreadIds: string[] = []
  let snapshotLoadCount = 0
  installWindowApiStub({
    getAgentThreadData: async () => {
      snapshotLoadCount += 1
      return createThreadDataSnapshot({
        metadata: {
          model: "openai:gpt-4o"
        },
        messages: [createUserMessage("user-history", "History copy")],
        status: "busy"
      })
    },
    onConnect: (callback) => {
      connection.listener = callback
    },
    onReplayThreadEvents: (threadId) => {
      replayedThreadIds.push(threadId)
      connection.listener?.({
        events: [
          {
            message: createUserMessage("user-1", "Question from event replay"),
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
              runId: "run-a",
              startedAt: new Date("2026-01-01T00:00:00.000Z"),
              status: "running",
              threadId,
              toolCalls: [],
              turnId: "user-1",
              userMessageId: "user-1"
            },
            type: "run.resumed"
          }
        ],
        latestRevision: 2,
        threadId
      })
    }
  })
  const store = createThreadStore()
  const manager = createAgentRuntimeManager({ threadStore: store })

  await manager.loadThreadData("thread-a")

  const state = getThreadState(store, "thread-a")
  assert.equal(snapshotLoadCount, 1)
  assert.deepEqual(replayedThreadIds, ["thread-a"])
  assert.equal(state.agent.currentModel, "openai:gpt-4o")
  assert.equal(state.agent.activeRun?.status, "running")
  assert.deepEqual(
    state.agent.messagesPage.map((message) => message.content),
    ["Question from event replay"]
  )
})

test("agent runtime manager replays interrupted runtime facts instead of applying snapshots", async () => {
  const pendingApproval = createPendingApproval()
  const contextInclusion = createContextInclusion()
  const snapshotApproval: HITLRequest = {
    ...pendingApproval,
    id: "hitl:thread-a:snapshot:tool-snapshot",
    tool_call: {
      ...pendingApproval.tool_call,
      id: "tool-snapshot"
    }
  }
  const connection: {
    listener: ((batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void) | null
  } = {
    listener: null
  }
  const replayedThreadIds: string[] = []
  installWindowApiStub({
    getAgentThreadData: async () =>
      createThreadDataSnapshot({
        contextInclusions: [contextInclusion],
        metadata: {
          model: "openai:gpt-4o"
        },
        messages: [
          createUserMessage("snapshot-user", "Snapshot approval copy"),
          {
            ...createAssistantMessage("snapshot-assistant", ""),
            tool_calls: [snapshotApproval.tool_call]
          }
        ],
        pendingApproval: snapshotApproval,
        status: "interrupted",
        workspacePath: "/tmp/interrupted"
      }),
    onConnect: (callback) => {
      connection.listener = callback
    },
    onReplayThreadEvents: (threadId) => {
      replayedThreadIds.push(threadId)
      connection.listener?.({
        events: [
          {
            message: createUserMessage("user-1", "Needs approval"),
            revision: 1,
            type: "message.upserted"
          },
          {
            message: {
              ...createAssistantMessage("assistant-1", ""),
              tool_calls: [pendingApproval.tool_call]
            },
            revision: 2,
            type: "message.upserted"
          },
          {
            revision: 3,
            run: {
              assistantMessageId: "assistant-1",
              currentToolCallId: null,
              phase: "waiting_tool_result",
              phaseStartedAt: new Date("2026-01-01T00:00:00.000Z"),
              runId: "run-a",
              startedAt: new Date("2026-01-01T00:00:00.000Z"),
              status: "waiting_approval",
              threadId,
              toolCalls: [],
              turnId: "user-1",
              userMessageId: "user-1"
            },
            type: "run.resumed"
          },
          {
            approval: pendingApproval,
            requestedAt: new Date("2026-01-01T00:00:02.000Z"),
            revision: 4,
            runId: "run-a",
            type: "approval.requested"
          },
          {
            inclusions: [contextInclusion],
            revision: 5,
            type: "context.inclusionsReplaced"
          }
        ] satisfies AgentThreadEvent[],
        latestRevision: 5,
        threadId
      })
    }
  })
  const store = createThreadStore()
  const manager = createAgentRuntimeManager({ threadStore: store })

  await manager.loadThreadData("thread-a")

  const state = getThreadState(store, "thread-a")
  assert.deepEqual(replayedThreadIds, ["thread-a"])
  assert.equal(state.agent.currentModel, "openai:gpt-4o")
  assert.equal(state.agent.workspacePath, "/tmp/interrupted")
  assert.equal(state.agent.pendingApproval?.id, pendingApproval.id)
  assert.equal(state.agent.contextInclusions[0]?.id, contextInclusion.id)
  assert.equal(state.agent.activeRun?.status, "waiting_approval")
  assert.equal(state.agent.activeRun?.assistantMessageId, "assistant-1")
  assert.equal(state.agent.activeRun?.turnId, "user-1")
  assert.deepEqual(
    state.agent.messagesPage.map((message) => message.content),
    ["Needs approval", ""]
  )
})

test("agent runtime manager surfaces explicit thread data load failures", async () => {
  installWindowApiStub({
    getAgentThreadData: async () => {
      throw new Error("snapshot unavailable")
    }
  })
  const store = createThreadStore()
  const manager = createAgentRuntimeManager({ threadStore: store })

  await assert.rejects(manager.loadThreadData("thread-a"), /snapshot unavailable/)
})

test("agent runtime manager reports background resync failures", async () => {
  const connection: {
    listener: ((batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void) | null
  } = {
    listener: null
  }
  const runtimeErrors: unknown[] = []
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => {
    runtimeErrors.push(args)
  }
  installWindowApiStub({
    getAgentThreadData: async () => {
      throw new Error("resync unavailable")
    },
    onConnect: (callback) => {
      connection.listener = callback
    }
  })
  const store = createThreadStore()
  const manager = createAgentRuntimeManager({ threadStore: store })

  try {
    await manager.awaitThreadRuntime("thread-a")
    const connectedListener = connection.listener
    assert.ok(connectedListener)

    connectedListener({
      events: [
        {
          message: createUserMessage("user-2", "Gap event"),
          revision: 2,
          type: "message.upserted"
        }
      ],
      latestRevision: 2,
      threadId: "thread-a"
    })
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    console.error = originalConsoleError
  }

  assert.equal(runtimeErrors.length, 1)
  assert.deepEqual(runtimeErrors[0], [
    "[JingleAgentRuntimeClient] Runtime resync failed.",
    {
      entry: "runtimeResync",
      error: new Error("resync unavailable"),
      threadId: "thread-a"
    }
  ])
})

test("agent runtime manager queues live batches behind a single runtime gap resync", async () => {
  const connection: {
    listener: ((batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void) | null
  } = {
    listener: null
  }
  const runtimeWarnings: unknown[] = []
  const replayedOptions: Array<JingleAgentRuntimeReplayOptions | undefined> = []
  const replayControl: {
    release: (() => void) | null
  } = {
    release: null
  }
  const replayGate = new Promise<void>((resolve) => {
    replayControl.release = resolve
  })
  const originalConsoleWarn = console.warn
  console.warn = (...args: unknown[]) => {
    runtimeWarnings.push(args)
  }

  installWindowApiStub({
    onConnect: (callback) => {
      connection.listener = callback
    },
    getAgentThreadData: async () =>
      createThreadDataSnapshot({
        messages: [],
        status: "busy"
      }),
    onReplayThreadEvents: async (_threadId, options) => {
      replayedOptions.push(options)
      await replayGate
      connection.listener?.({
        events: [
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
              runId: "run-a",
              startedAt: new Date("2026-01-01T00:00:00.000Z"),
              status: "running",
              threadId: "thread-a",
              toolCalls: [],
              turnId: "user-1",
              userMessageId: "user-1"
            },
            type: "run.started"
          }
        ],
        latestRevision: 2,
        threadId: "thread-a"
      })
    }
  })
  const store = createThreadStore()
  const manager = createAgentRuntimeManager({ threadStore: store })

  try {
    await manager.awaitThreadRuntime("thread-a")
    const connectedListener = connection.listener
    assert.ok(connectedListener)

    connectedListener({
      events: [
        {
          revision: 2,
          run: {
            assistantMessageId: null,
            currentToolCallId: null,
            phase: "thinking",
            phaseStartedAt: new Date("2026-01-01T00:00:00.000Z"),
            runId: "run-a",
            startedAt: new Date("2026-01-01T00:00:00.000Z"),
            status: "running",
            threadId: "thread-a",
            toolCalls: [],
            turnId: "user-1",
            userMessageId: "user-1"
          },
          type: "run.started"
        }
      ],
      latestRevision: 2,
      threadId: "thread-a"
    })
    connectedListener({
      events: [
        {
          phase: "waiting_tool_result",
          revision: 3,
          runId: "run-a",
          startedAt: new Date("2026-01-01T00:00:01.000Z"),
          type: "run.phaseChanged"
        }
      ],
      latestRevision: 3,
      threadId: "thread-a"
    })
    replayControl.release?.()
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    console.warn = originalConsoleWarn
  }

  const state = getThreadState(store, "thread-a")
  assert.equal(runtimeWarnings.length, 1)
  assert.deepEqual(replayedOptions, [{ fromRevision: 0 }])
  assert.equal(state.agent.revision, 3)
  assert.equal(state.agent.activeRun?.phase, "waiting_tool_result")
})

test("agent runtime manager reports background history refresh failures", async () => {
  const connection: {
    listener: ((batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void) | null
  } = {
    listener: null
  }
  const runtimeErrors: unknown[] = []
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => {
    runtimeErrors.push(args)
  }
  installWindowApiStub({
    onConnect: (callback) => {
      connection.listener = callback
    }
  })
  const store = createThreadStore()
  const manager = createAgentRuntimeManager({
    refreshThread: async () => {
      throw new Error("history refresh unavailable")
    },
    threadStore: store
  })

  try {
    await manager.awaitThreadRuntime("thread-a")
    const connectedListener = connection.listener
    assert.ok(connectedListener)

    connectedListener({
      events: [
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
            runId: "run-a",
            startedAt: new Date("2026-01-01T00:00:00.000Z"),
            status: "running",
            threadId: "thread-a",
            toolCalls: [],
            turnId: "user-1",
            userMessageId: "user-1"
          },
          type: "run.started"
        }
      ],
      latestRevision: 2,
      threadId: "thread-a"
    })
    connectedListener({
      events: [
        {
          completedAt: new Date("2026-01-01T00:00:02.000Z"),
          durationMs: 2_000,
          error: null,
          revision: 3,
          runId: "run-a",
          status: "completed",
          type: "run.finished"
        }
      ],
      latestRevision: 3,
      threadId: "thread-a"
    })
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    console.error = originalConsoleError
  }

  assert.equal(runtimeErrors.length, 1)
  assert.deepEqual(runtimeErrors[0], [
    "[JingleAgentRuntimeClient] History refresh failed.",
    {
      entry: "historyRefresh",
      error: new Error("history refresh unavailable"),
      threadId: "thread-a"
    }
  ])
})

test("agent runtime manager reports synchronous background history refresh failures", async () => {
  const connection: {
    listener: ((batch: JingleRuntimeEventBatch<AgentThreadEvent>) => void) | null
  } = {
    listener: null
  }
  const runtimeErrors: unknown[] = []
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => {
    runtimeErrors.push(args)
  }
  installWindowApiStub({
    onConnect: (callback) => {
      connection.listener = callback
    }
  })
  const store = createThreadStore()
  const manager = createAgentRuntimeManager({
    refreshThread: () => {
      throw new Error("sync history refresh unavailable")
    },
    threadStore: store
  })

  try {
    await manager.awaitThreadRuntime("thread-a")
    const connectedListener = connection.listener
    assert.ok(connectedListener)

    connectedListener({
      events: [
        {
          revision: 1,
          run: {
            assistantMessageId: null,
            currentToolCallId: null,
            phase: "thinking",
            phaseStartedAt: new Date("2026-01-01T00:00:00.000Z"),
            runId: "run-a",
            startedAt: new Date("2026-01-01T00:00:00.000Z"),
            status: "running",
            threadId: "thread-a",
            toolCalls: [],
            turnId: "user-1",
            userMessageId: "user-1"
          },
          type: "run.started"
        }
      ],
      latestRevision: 1,
      threadId: "thread-a"
    })
    connectedListener({
      events: [
        {
          completedAt: new Date("2026-01-01T00:00:02.000Z"),
          durationMs: 2_000,
          error: null,
          revision: 2,
          runId: "run-a",
          status: "completed",
          type: "run.finished"
        }
      ],
      latestRevision: 2,
      threadId: "thread-a"
    })
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    console.error = originalConsoleError
  }

  assert.equal(runtimeErrors.length, 1)
  assert.deepEqual(runtimeErrors[0], [
    "[JingleAgentRuntimeClient] History refresh failed.",
    {
      entry: "historyRefresh",
      error: new Error("sync history refresh unavailable"),
      threadId: "thread-a"
    }
  ])
})
