import assert from "node:assert/strict"
import test from "node:test"
import type { AgentThreadDataSnapshot } from "../../src/shared/app-types"
import {
  invokeAgentThread,
  resumeAgentThread,
  updateAgentThreadModel,
  updateAgentThreadPermissionMode
} from "../../src/renderer/src/lib/agent-control"
import {
  createThreadStore,
  type AgentSourceState,
  type ThreadStore
} from "../../src/renderer/src/lib/thread-store-core"
import type { HITLRequest } from "../../src/renderer/src/types"

function getAgentCommandState(
  store: ThreadStore,
  threadId: string
): Pick<
  AgentSourceState,
  "activeRun" | "currentModel" | "pendingApproval" | "permissionMode" | "workspacePath"
> | null {
  const state = store.getThreadState(threadId)
  if (!state) {
    return null
  }

  return {
    activeRun: state.agent.activeRun,
    currentModel: state.agent.currentModel,
    pendingApproval: state.agent.pendingApproval,
    permissionMode: state.agent.permissionMode,
    workspacePath: state.agent.workspacePath
  }
}

function createThreadDataSnapshot(
  input: Partial<AgentThreadDataSnapshot>
): AgentThreadDataSnapshot {
  return {
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
    thread: {
      metadata: undefined,
      status: "idle",
      thread_id: "thread-a",
      title: undefined
    },
    ...input
  }
}

function installWindowApiStub(input?: { threadMetadata?: Record<string, unknown> }): {
  invoked: Array<{
    message: unknown
    modelId: string
    permissionMode: string
    temporaryMode: boolean
    threadId: string
  }>
  resumed: Array<{
    modelId: string
    requestId: string
    threadId: string
    toolCallId: string
  }>
  threadUpdates: Array<{
    metadata: Record<string, unknown>
    threadId: string
  }>
} {
  const invoked: Array<{
    message: unknown
    modelId: string
    permissionMode: string
    temporaryMode: boolean
    threadId: string
  }> = []
  const resumed: Array<{
    modelId: string
    requestId: string
    threadId: string
    toolCallId: string
  }> = []
  const threadUpdates: Array<{
    metadata: Record<string, unknown>
    threadId: string
  }> = []

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      api: {
        agent: {
          invoke: (
            threadId: string,
            message: unknown,
            modelId: string,
            permissionMode: string,
            temporaryMode: boolean
          ) => {
            invoked.push({
              message,
              modelId,
              permissionMode,
              temporaryMode,
              threadId
            })
          },
          resume: (
            threadId: string,
            decision: { request_id: string; tool_call_id: string },
            modelId: string
          ) => {
            resumed.push({
              modelId,
              requestId: decision.request_id,
              threadId,
              toolCallId: decision.tool_call_id
            })
          }
        },
        threads: {
          get: async (threadId: string) => ({
            created_at: new Date("2026-01-01T00:00:00.000Z"),
            metadata: input?.threadMetadata ?? {},
            status: "idle",
            thread_id: threadId,
            updated_at: new Date("2026-01-01T00:00:00.000Z")
          })
        }
      }
    }
  })

  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID: () => "message-id"
    }
  })

  return { invoked, resumed, threadUpdates }
}

function createPendingApproval(): HITLRequest {
  return {
    allowed_decisions: ["approve", "reject"],
    id: "hitl:thread-a:run-a:tool-a",
    review: null,
    tool_call: {
      args: {},
      id: "tool-a",
      name: "execute_command",
      type: "tool_call"
    }
  }
}

test("invokeAgentThread invokes runtime through command layer without local UI mutation", async () => {
  const { invoked } = installWindowApiStub()
  const store = createThreadStore()
  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      thread: {
        metadata: {
          model: "model-a",
          permissionMode: "explore"
        },
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )

  const didInvoke = await invokeAgentThread({
    messageInput: {
      refs: [],
      text: "hello"
    },
    temporaryMode: true,
    threadContext: {
      awaitThreadRuntime: async () => {},
      getAgentCommandState: (threadId) => getAgentCommandState(store, threadId)
    },
    threadId: "thread-a"
  })

  assert.equal(didInvoke, true)
  assert.deepEqual(invoked, [
    {
      message: {
        content: "hello",
        id: "message-id"
      },
      modelId: "model-a",
      permissionMode: "explore",
      temporaryMode: true,
      threadId: "thread-a"
    }
  ])
})

test("invokeAgentThread sends assistant selection refs as model context and metadata refs", async () => {
  const { invoked } = installWindowApiStub()
  const store = createThreadStore()
  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      thread: {
        metadata: {
          model: "model-a",
          permissionMode: "explore"
        },
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )

  const didInvoke = await invokeAgentThread({
    messageInput: {
      refs: [
        {
          selectedText: "snapshot should not own runtime facts",
          sourceMessageId: "assistant-message-1",
          sourceThreadId: "thread-a",
          type: "assistant-message-selection"
        }
      ],
      text: "Is this still true?"
    },
    threadContext: {
      awaitThreadRuntime: async () => {},
      getAgentCommandState: (threadId) => getAgentCommandState(store, threadId)
    },
    threadId: "thread-a"
  })

  assert.equal(didInvoke, true)
  assert.deepEqual(invoked, [
    {
      message: {
        additional_kwargs: {
          refs: [
            {
              selectedText: "snapshot should not own runtime facts",
              sourceMessageId: "assistant-message-1",
              sourceThreadId: "thread-a",
              type: "assistant-message-selection"
            }
          ]
        },
        content:
          "Is this still true?\n\nReferenced assistant selections:\n1. snapshot should not own runtime facts",
        id: "message-id"
      },
      modelId: "model-a",
      permissionMode: "explore",
      temporaryMode: false,
      threadId: "thread-a"
    }
  ])
})

test("invokeAgentThread rejects assistant selection refs without visible user text", async () => {
  const { invoked } = installWindowApiStub()
  const store = createThreadStore()
  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      thread: {
        metadata: {
          model: "model-a",
          permissionMode: "explore"
        },
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )

  const didInvoke = await invokeAgentThread({
    messageInput: {
      refs: [
        {
          selectedText: "selected assistant text",
          sourceMessageId: "assistant-message-1",
          sourceThreadId: "thread-a",
          type: "assistant-message-selection"
        }
      ],
      text: ""
    },
    threadContext: {
      awaitThreadRuntime: async () => {},
      getAgentCommandState: (threadId) => getAgentCommandState(store, threadId)
    },
    threadId: "thread-a"
  })

  assert.equal(didInvoke, false)
  assert.deepEqual(invoked, [])
})

test("invokeAgentThread rejects busy threads before calling runtime", async () => {
  const { invoked } = installWindowApiStub()
  const store = createThreadStore()
  store.applyRuntimeEvents("thread-a", [
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
        turnId: "turn-a",
        userMessageId: "user-a"
      },
      type: "run.started"
    }
  ])

  const didInvoke = await invokeAgentThread({
    messageInput: {
      refs: [],
      text: "hello"
    },
    threadContext: {
      awaitThreadRuntime: async () => {},
      getAgentCommandState: (threadId) => getAgentCommandState(store, threadId)
    },
    threadId: "thread-a"
  })

  assert.equal(didInvoke, false)
  assert.deepEqual(invoked, [])
})

test("invokeAgentThread validates with command facts instead of full thread state", async () => {
  const { invoked } = installWindowApiStub()
  const store = createThreadStore()
  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      thread: {
        metadata: {
          model: "model-a"
        },
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  let localError: string | null = null
  let validationInput: unknown = null

  const didInvoke = await invokeAgentThread({
    messageInput: {
      refs: [],
      text: "hello"
    },
    onLocalError: (error) => {
      localError = error
    },
    threadContext: {
      awaitThreadRuntime: async () => {},
      getAgentCommandState: (threadId) => getAgentCommandState(store, threadId)
    },
    threadId: "thread-a",
    validateRun: (input) => {
      validationInput = input
      return "select workspace"
    }
  })

  assert.equal(didInvoke, false)
  assert.deepEqual(validationInput, {
    message: "hello",
    threadId: "thread-a",
    workspacePath: null
  })
  assert.equal(localError, "select workspace")
  assert.deepEqual(invoked, [])
})

test("resumeAgentThread reads approval and model from command-time thread state", async () => {
  const { resumed } = installWindowApiStub()
  const store = createThreadStore()
  store.applyThreadDataSnapshot(
    "thread-a",
    createThreadDataSnapshot({
      thread: {
        metadata: {
          model: "model-a"
        },
        status: "idle",
        thread_id: "thread-a",
        title: undefined
      }
    })
  )
  store.applyRuntimeEvents("thread-a", [
    {
      approval: createPendingApproval(),
      requestedAt: new Date("2026-01-01T00:00:02.000Z"),
      revision: 1,
      runId: "run-a",
      type: "approval.requested"
    }
  ])

  const didResume = await resumeAgentThread({
    decision: { type: "approve" },
    threadContext: {
      getAgentCommandState: (threadId) => getAgentCommandState(store, threadId)
    },
    threadId: "thread-a"
  })

  assert.equal(didResume, true)
  assert.deepEqual(resumed, [
    {
      modelId: "model-a",
      requestId: "hitl:thread-a:run-a:tool-a",
      threadId: "thread-a",
      toolCallId: "tool-a"
    }
  ])
})

test("updateAgentThreadModel persists metadata and reloads source snapshot", async () => {
  installWindowApiStub({
    threadMetadata: {
      permissionMode: "explore",
      source: "launcher-ai"
    }
  })
  const loadCalls: string[] = []
  const updates: Array<{
    metadata: Record<string, unknown>
    threadId: string
  }> = []

  await updateAgentThreadModel({
    modelId: "model-b",
    threadContext: {
      loadThreadData: async (threadId) => {
        loadCalls.push(threadId)
      }
    },
    threadId: "thread-a",
    updateThread: async (threadId, update) => {
      updates.push({ metadata: update.metadata, threadId })
    }
  })

  assert.deepEqual(updates, [
    {
      metadata: {
        model: "model-b",
        permissionMode: "explore",
        source: "launcher-ai"
      },
      threadId: "thread-a"
    }
  ])
  assert.deepEqual(loadCalls, ["thread-a"])
})

test("updateAgentThreadPermissionMode persists metadata and reloads source snapshot", async () => {
  installWindowApiStub({
    threadMetadata: {
      model: "model-a",
      source: "launcher-ai"
    }
  })
  const updates: Array<{
    metadata: Record<string, unknown>
    threadId: string
  }> = []

  await updateAgentThreadPermissionMode({
    permissionMode: "auto",
    threadContext: {
      loadThreadData: async () => {}
    },
    threadId: "thread-a",
    updateThread: async (threadId, update) => {
      updates.push({ metadata: update.metadata, threadId })
    }
  })

  assert.deepEqual(updates, [
    {
      metadata: {
        model: "model-a",
        permissionMode: "auto",
        source: "launcher-ai"
      },
      threadId: "thread-a"
    }
  ])
})
