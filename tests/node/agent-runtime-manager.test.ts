import assert from "node:assert/strict"
import test from "node:test"
import type { AgentThreadEventBatch } from "../../src/shared/agent-thread-runtime"
import type { AgentThreadDataSnapshot } from "../../src/shared/app-types"
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

function createThreadDataSnapshot(input: {
  messages: Message[]
  status?: AgentThreadDataSnapshot["thread"]["status"]
}): AgentThreadDataSnapshot {
  return {
    messages: {
      artifacts: [],
      messages: input.messages
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
      status: input.status ?? "idle",
      thread_id: "thread-a",
      title: undefined
    }
  }
}

function installWindowApiStub(input: {
  getAgentThreadData?: (threadId: string) => Promise<AgentThreadDataSnapshot>
  onConnect?: (callback: (batch: AgentThreadEventBatch) => void) => void
}): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      api: {
        agent: {
          connectThreadEvents: (
            _threadId: string,
            callback: (batch: AgentThreadEventBatch) => void
          ) => {
            input.onConnect?.(callback)
            return Object.assign(() => {}, {
              ready: Promise.resolve()
            })
          },
          replayThreadEvents: async () => {}
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
    listener: ((batch: AgentThreadEventBatch) => void) | null
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
          phase: "thinking",
          runId: null,
          status: "running",
          threadId: "thread-a",
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
    state.agent.messages.map((message) => message.id),
    ["user-1"]
  )
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
    state.agent.messages.map((message) => message.id),
    ["user-1", "assistant-1"]
  )
  assert.equal(state.view.messageProjection.turns.length, 1)
})
