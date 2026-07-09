import assert from "node:assert/strict"
import test from "node:test"
import {
  buildJingleAgentCommandEnvelope,
  buildJingleAgentModelMetadataUpdate,
  buildJingleAgentPermissionMetadataUpdate,
  resolveJingleAgentFollowUpDrainPlan,
  resolveJingleAgentFollowUpPlan,
  resolveJingleAgentEditReadiness,
  resolveJingleAgentInvokeReadiness,
  resolveJingleAgentResumeReadiness,
  selectJingleAgentCommandState,
  shouldSurfaceJingleSteerRejection,
  type JingleAgentComposerMessageInput
} from "@jingle/agent-client"
import type { AgentThreadDataSnapshot } from "../../src/shared/app-types"
import {
  editLastUserMessageAndInvokeAgentThread,
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
): ReturnType<typeof selectJingleAgentCommandState<AgentSourceState["permissionMode"]>> {
  const state = store.getThreadState(threadId)
  return selectJingleAgentCommandState(state?.agent)
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
    },
    ...input
  }
}

function installWindowApiStub(input?: {
  followUpMode?: "queue" | "steer"
  threadMetadata?: Record<string, unknown>
}): {
  edited: Array<{
    message: unknown
    modelId: string
    permissionMode: string
    temporaryMode: boolean
    threadId: string
  }>
  invoked: Array<{
    followUpAction?: string
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
  const edited: Array<{
    message: unknown
    modelId: string
    permissionMode: string
    temporaryMode: boolean
    threadId: string
  }> = []
  const invoked: Array<{
    expectedRunId?: string | null
    expectedTurnId?: string | null
    followUpAction?: string
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
          editLastUserMessageAndInvoke: (
            threadId: string,
            message: unknown,
            modelId: string,
            permissionMode: string,
            temporaryMode: boolean
          ) => {
            edited.push({
              message,
              modelId,
              permissionMode,
              temporaryMode,
              threadId
            })
          },
          invoke: (
            threadId: string,
            message: unknown,
            modelId: string,
            permissionMode: string,
            temporaryMode: boolean,
            followUpAction?: string,
            expectedRunId?: string | null,
            expectedTurnId?: string | null
          ) => {
            invoked.push({
              ...(expectedRunId !== undefined ? { expectedRunId } : {}),
              ...(expectedTurnId !== undefined ? { expectedTurnId } : {}),
              ...(followUpAction ? { followUpAction } : {}),
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
        },
        settings: {
          getAgentConfig: async () => ({
            desktopAutomationAllowlist: [],
            followUpMode: input?.followUpMode ?? "steer",
            locale: "zh-CN",
            skillSources: []
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

  return { edited, invoked, resumed, threadUpdates }
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

test("jingle agent client owns command readiness policy", () => {
  const pendingApproval = createPendingApproval()
  const pendingApprovalRef = {
    id: pendingApproval.id,
    toolCall: {
      id: pendingApproval.tool_call.id
    }
  }
  const idleState = {
    activeRun: null,
    currentModel: "model-a",
    pendingApproval: null,
    permissionMode: "explore",
    workspacePath: null
  }

  assert.deepEqual(resolveJingleAgentInvokeReadiness({ state: null, threadId: "thread-a" }), {
    message: "Agent thread state is not initialized: thread-a",
    type: "error"
  })
  assert.deepEqual(
    resolveJingleAgentInvokeReadiness({
      state: {
        ...idleState,
        pendingApproval: pendingApprovalRef
      },
      threadId: "thread-a"
    }),
    { type: "blocked" }
  )
  assert.equal(
    resolveJingleAgentEditReadiness({
      state: {
        ...idleState,
        activeRun: { status: "running" }
      },
      threadId: "thread-a"
    }).type,
    "blocked"
  )
  assert.deepEqual(
    resolveJingleAgentResumeReadiness({
      state: {
        ...idleState,
        currentModel: null,
        pendingApproval: pendingApprovalRef
      },
      threadId: "thread-a"
    }),
    { type: "blocked" }
  )
  assert.deepEqual(
    resolveJingleAgentInvokeReadiness({
      state: {
        ...idleState,
        currentModel: null
      },
      threadId: "thread-a"
    }),
    { type: "blocked" }
  )

  const resumeReadiness = resolveJingleAgentResumeReadiness({
    state: {
      ...idleState,
      pendingApproval: pendingApprovalRef
    },
    threadId: "thread-a"
  })
  assert.equal(resumeReadiness.type, "ready")
  assert.equal(
    resumeReadiness.type === "ready" ? resumeReadiness.state.currentModel : null,
    "model-a"
  )
  assert.equal(
    resumeReadiness.type === "ready" ? resumeReadiness.state.pendingApproval.id : null,
    "hitl:thread-a:run-a:tool-a"
  )
})

test("jingle agent client preserves explicit steer follow-up intent", () => {
  assert.deepEqual(
    resolveJingleAgentFollowUpPlan({
      isRunning: false,
      requestedAction: "steer"
    }),
    { action: "steer", type: "invoke" }
  )
})

test("jingle agent client owns queued follow-up drain policy", () => {
  assert.deepEqual(
    resolveJingleAgentFollowUpDrainPlan({
      activeRequestId: null,
      nextRequestId: "follow-up-1",
      runtimeStatus: "idle",
      threadId: "thread-a"
    }),
    {
      requestId: "follow-up-1",
      threadId: "thread-a",
      type: "drain"
    }
  )
  assert.deepEqual(
    resolveJingleAgentFollowUpDrainPlan({
      activeRequestId: "follow-up-1",
      nextRequestId: "follow-up-1",
      runtimeStatus: "idle",
      threadId: "thread-a"
    }),
    { type: "idle" }
  )
  assert.deepEqual(
    resolveJingleAgentFollowUpDrainPlan({
      activeRequestId: null,
      nextRequestId: "follow-up-1",
      runtimeStatus: "running",
      threadId: "thread-a"
    }),
    { type: "idle" }
  )
})

test("jingle agent client owns thread metadata command patches", () => {
  assert.deepEqual(
    buildJingleAgentModelMetadataUpdate({
      currentMetadata: {
        permissionMode: "explore",
        source: "launcher-ai"
      },
      modelId: "model-b"
    }),
    {
      model: "model-b",
      permissionMode: "explore",
      source: "launcher-ai"
    }
  )
  assert.deepEqual(
    buildJingleAgentPermissionMetadataUpdate({
      currentMetadata: {
        model: "model-a",
        source: "launcher-ai"
      },
      permissionMode: "auto"
    }),
    {
      model: "model-a",
      permissionMode: "auto",
      source: "launcher-ai"
    }
  )
})

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
        content:
          "Is this still true?\n\nReferenced assistant selections:\n1. snapshot should not own runtime facts",
        id: "message-id",
        refs: [
          {
            selectedText: "snapshot should not own runtime facts",
            sourceMessageId: "assistant-message-1",
            sourceThreadId: "thread-a",
            type: "assistant-message-selection"
          }
        ]
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

test("editLastUserMessageAndInvokeAgentThread preserves refs as edited message context", async () => {
  const { edited } = installWindowApiStub()
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

  const didEdit = await editLastUserMessageAndInvokeAgentThread({
    messageId: "user-1",
    messageInput: {
      refs: [
        {
          selectedText: "old selected assistant text",
          sourceMessageId: "assistant-message-1",
          sourceThreadId: "thread-a",
          type: "assistant-message-selection"
        }
      ],
      text: "edited text"
    },
    threadContext: {
      awaitThreadRuntime: async () => {},
      getAgentCommandState: (threadId) => getAgentCommandState(store, threadId)
    },
    threadId: "thread-a"
  })

  assert.equal(didEdit, true)
  assert.deepEqual(edited, [
    {
      message: {
        content: "edited text\n\nReferenced assistant selections:\n1. old selected assistant text",
        id: "user-1",
        refs: [
          {
            selectedText: "old selected assistant text",
            sourceMessageId: "assistant-message-1",
            sourceThreadId: "thread-a",
            type: "assistant-message-selection"
          }
        ]
      },
      modelId: "model-a",
      permissionMode: "explore",
      temporaryMode: false,
      threadId: "thread-a"
    }
  ])
})

test("invokeAgentThread queues running follow-ups through command owner when configured to queue", async () => {
  const { invoked } = installWindowApiStub({ followUpMode: "queue" })
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
  const queuedInputs: JingleAgentComposerMessageInput[] = []

  const didInvoke = await invokeAgentThread({
    messageInput: {
      refs: [],
      text: "queue this"
    },
    onQueueFollowUp: (messageInput) => {
      queuedInputs.push(messageInput)
    },
    threadContext: {
      awaitThreadRuntime: async () => {},
      getAgentCommandState: (threadId) => getAgentCommandState(store, threadId)
    },
    threadId: "thread-a"
  })

  assert.equal(didInvoke, true)
  assert.deepEqual(invoked, [])
  assert.deepEqual(queuedInputs, [
    {
      refs: [],
      text: "queue this"
    }
  ])
})

test("jingle agent client builds command payloads without shared message-content", () => {
  const envelope = buildJingleAgentCommandEnvelope({
    messageInput: {
      refs: [
        {
          name: "spec.md",
          path: "/workspace/spec.md",
          type: "file"
        },
        {
          name: "diagram",
          type: "image",
          url: "file:///tmp/diagram.png"
        },
        {
          selectedText: "Do not infer durable facts from UI text.",
          sourceMessageId: "assistant-1",
          sourceThreadId: "thread-a",
          type: "assistant-message-selection"
        }
      ],
      text: "Review this"
    }
  })

  assert.deepEqual(envelope, {
    content: [
      {
        text: "Review this",
        type: "text"
      },
      {
        image_url: {
          url: "file:///tmp/diagram.png"
        },
        name: "diagram",
        type: "image_url"
      },
      {
        text: "Attached files:\n- spec.md",
        type: "text"
      },
      {
        text: "Referenced assistant selections:\n1. Do not infer durable facts from UI text.",
        type: "text"
      }
    ],
    refs: [
      {
        name: "spec.md",
        path: "/workspace/spec.md",
        type: "file"
      },
      {
        name: "diagram",
        type: "image",
        url: "file:///tmp/diagram.png"
      },
      {
        selectedText: "Do not infer durable facts from UI text.",
        sourceMessageId: "assistant-1",
        sourceThreadId: "thread-a",
        type: "assistant-message-selection"
      }
    ],
    validationText: "Review this"
  })
})

test("invokeAgentThread sends running follow-ups with the configured follow-up action", async () => {
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

  assert.equal(didInvoke, true)
  assert.deepEqual(invoked, [
    {
      expectedRunId: "run-a",
      expectedTurnId: "turn-a",
      followUpAction: "steer",
      message: {
        content: "hello",
        id: "message-id"
      },
      modelId: "model-a",
      permissionMode: "explore",
      temporaryMode: false,
      threadId: "thread-a"
    }
  ])
})

test("invokeAgentThread preserves an explicit steer action after a queued item is taken", async () => {
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
      text: "steer queued item"
    },
    followUpAction: "steer",
    threadContext: {
      awaitThreadRuntime: async () => {},
      getAgentCommandState: (threadId) => getAgentCommandState(store, threadId)
    },
    threadId: "thread-a"
  })

  assert.equal(didInvoke, true)
  assert.deepEqual(invoked, [
    {
      followUpAction: "steer",
      message: {
        content: "steer queued item",
        id: "message-id"
      },
      modelId: "model-a",
      permissionMode: "explore",
      temporaryMode: false,
      threadId: "thread-a"
    }
  ])
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

test("shouldSurfaceJingleSteerRejection 仅对需提示用户的拒绝原因返回 true", () => {
  assert.equal(shouldSurfaceJingleSteerRejection("active_run_mismatch"), true)
  assert.equal(shouldSurfaceJingleSteerRejection("active_turn_mismatch"), true)
  assert.equal(shouldSurfaceJingleSteerRejection("invalid_message"), true)
  assert.equal(shouldSurfaceJingleSteerRejection("no_active_run"), false)
  assert.equal(shouldSurfaceJingleSteerRejection("queue_item_not_found"), false)
})
