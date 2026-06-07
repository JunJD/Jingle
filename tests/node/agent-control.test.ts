import assert from "node:assert/strict"
import test from "node:test"
import { invokeAgentThread, resumeAgentThread } from "../../src/renderer/src/lib/agent-control"
import {
  createThreadStore,
  type ThreadState,
  type ThreadStore
} from "../../src/renderer/src/lib/thread-store-core"
import type { HITLRequest } from "../../src/renderer/src/types"

function getThreadState(store: ThreadStore, threadId: string): ThreadState {
  const state = store.getThreadState(threadId)
  assert.ok(state, `Expected thread state for ${threadId}`)
  return state
}

function installWindowApiStub(): {
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

  return { invoked, resumed }
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

test("invokeAgentThread invokes runtime through command layer without view projection", async () => {
  const { invoked } = installWindowApiStub()
  const store = createThreadStore()
  const actions = store.getThreadActions("thread-a")
  actions.setCurrentModel("model-a")
  actions.setPermissionMode("explore")
  actions.setDraftInput("draft")

  const didInvoke = await invokeAgentThread({
    messageInput: {
      refs: [],
      text: "hello"
    },
    temporaryMode: true,
    threadContext: {
      awaitThreadRuntime: async () => {},
      getThreadActions: store.getThreadActions,
      getThreadState: store.getThreadState
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
  assert.equal(getThreadState(store, "thread-a").ui.draftInput, "")
})

test("invokeAgentThread sends assistant selection refs as model context and metadata refs", async () => {
  const { invoked } = installWindowApiStub()
  const store = createThreadStore()
  const actions = store.getThreadActions("thread-a")
  actions.setCurrentModel("model-a")
  actions.setPermissionMode("explore")

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
      getThreadActions: store.getThreadActions,
      getThreadState: store.getThreadState
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
  const actions = store.getThreadActions("thread-a")
  actions.setCurrentModel("model-a")
  actions.setPermissionMode("explore")

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
      getThreadActions: store.getThreadActions,
      getThreadState: store.getThreadState
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
        phase: "thinking",
        runId: "run-a",
        status: "running",
        threadId: "thread-a",
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
      getThreadActions: store.getThreadActions,
      getThreadState: store.getThreadState
    },
    threadId: "thread-a"
  })

  assert.equal(didInvoke, false)
  assert.deepEqual(invoked, [])
})

test("resumeAgentThread reads approval and model from command-time thread state", async () => {
  const { resumed } = installWindowApiStub()
  const store = createThreadStore()
  const actions = store.getThreadActions("thread-a")
  actions.setCurrentModel("model-a")
  store.applyRuntimeEvents("thread-a", [
    {
      approval: createPendingApproval(),
      revision: 1,
      runId: "run-a",
      type: "approval.requested"
    }
  ])

  const didResume = await resumeAgentThread({
    decision: { type: "approve" },
    threadContext: {
      getThreadState: store.getThreadState
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
