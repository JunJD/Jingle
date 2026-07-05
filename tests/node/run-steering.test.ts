import assert from "node:assert/strict"
import test from "node:test"
import { AIMessage, HumanMessage } from "@langchain/core/messages"
import { MemorySaver } from "@langchain/langgraph"
import { createMiddleware, FakeToolCallingModel } from "langchain"
import {
  createAgentRunSteeringBuffer,
  createRunSteeringMiddleware
} from "@jingle/langchain-agent-harness/transitional"
import type { RuntimeApprovalControllerContract } from "../../packages/langchain-agent-harness/src/runtime-contract"
import { defineJingleHarnessHook } from "../../packages/langchain-agent-harness/src/harness-hooks"
import { createRuntimeGraphEngine } from "../../packages/langchain-agent-harness/src/harness-runtime"

const unusedCompaction = {
  summarization: {
    compactMessages: async () => {
      throw new Error("run-steering tests do not execute compact operations.")
    },
    observeContextOverflow: () => {},
    prepareModelCall: async () => {
      throw new Error("run-steering tests do not prepare compaction model calls.")
    }
  }
}

const testApprovalController: RuntimeApprovalControllerContract = {
  allowedDecisions: ["approve", "reject"],
  policyRuntime: {
    evaluate: () => ({
      args: {},
      disposition: "allow"
    })
  }
}

type SteeringLifecycleTestHook = (state: { messages?: unknown[] }, runtime: unknown) => unknown

function getAfterModelHook(
  middleware: ReturnType<typeof createRunSteeringMiddleware>
): SteeringLifecycleTestHook {
  const hook = middleware.afterModel
  assert.ok(hook)
  return (typeof hook === "function" ? hook : hook.hook) as SteeringLifecycleTestHook
}

function getAfterAgentHook(
  middleware: ReturnType<typeof createRunSteeringMiddleware>
): SteeringLifecycleTestHook {
  const hook = middleware.afterAgent
  assert.ok(hook)
  return (typeof hook === "function" ? hook : hook.hook) as SteeringLifecycleTestHook
}

test("run steering reports accepted steers only after they are injected into a model call", async () => {
  const appliedMessageIds: string[] = []
  const buffer = createAgentRunSteeringBuffer({
    onSteersApplied: (steers) => {
      appliedMessageIds.push(...steers.map((steer) => steer.messageId))
    }
  })
  const middleware = createRunSteeringMiddleware(buffer)

  buffer.accept({
    message: {
      content: "focus on tests",
      id: "steer-message-1",
      text: "focus on tests"
    },
    runId: "run-1"
  })
  assert.deepEqual(appliedMessageIds, [])

  let observedMessages: unknown[] = []
  await middleware.wrapModelCall!(
    {
      messages: [new HumanMessage({ content: "hello", id: "user-message-1" })]
    } as never,
    async (request) => {
      observedMessages = request.messages
      return new AIMessage("done")
    }
  )

  assert.deepEqual(appliedMessageIds, ["steer-message-1"])
  assert.equal(observedMessages.length, 2)
  const injectedMessage = observedMessages[1]
  assert.ok(HumanMessage.isInstance(injectedMessage))
  assert.equal(injectedMessage.id, "steer-message-1")
  assert.equal(injectedMessage.content, "focus on tests")
})

test("run steering keeps the active run alive at the next safe model boundary", () => {
  const buffer = createAgentRunSteeringBuffer()
  const middleware = createRunSteeringMiddleware(buffer)
  const afterModel = getAfterModelHook(middleware)
  const afterAgent = getAfterAgentHook(middleware)

  buffer.accept({
    message: {
      content: "focus on tests",
      id: "steer-message-1",
      text: "focus on tests"
    },
    runId: "run-1"
  })

  const finalAnswerBoundary = afterModel(
    {
      messages: [new AIMessage("done")]
    },
    {}
  )
  assert.deepEqual(finalAnswerBoundary, { jumpTo: "model" })
  assert.deepEqual(
    afterAgent(
      {
        messages: [new AIMessage("done")]
      },
      {}
    ),
    { jumpTo: "model" }
  )

  const toolBoundary = afterModel(
    {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            {
              args: {},
              id: "tool-call-1",
              name: "search_web"
            }
          ]
        })
      ]
    },
    {}
  )
  assert.equal(toolBoundary, undefined)
})

test("run steering re-enters the graph when a pending steer arrives before final exit", async () => {
  const buffer = createAgentRunSteeringBuffer()
  const observedModelCalls: unknown[][] = []
  let acceptedAfterFirstModelCall = false
  const observerMiddleware = createMiddleware({
    name: "ObserveModelCalls",
    wrapModelCall: async (request, handler) => {
      observedModelCalls.push(request.messages)
      const response = await handler(request)
      if (!acceptedAfterFirstModelCall) {
        acceptedAfterFirstModelCall = true
        buffer.accept({
          message: {
            content: "focus on tests",
            id: "steer-message-1",
            text: "focus on tests"
          },
          runId: "run-1"
        })
      }
      return response
    }
  })
  const agent = createRuntimeGraphEngine({
    approvalController: testApprovalController,
    callbacks: [],
    checkpointer: new MemorySaver(),
    compaction: unusedCompaction,
    middleware: [createRunSteeringMiddleware(buffer), observerMiddleware],
    model: new FakeToolCallingModel(),
    systemPrompt: "",
    traceConfig: {}
  })

  await agent.invoke(
    {
      contextInclusions: [],
      messages: [new HumanMessage({ content: "hello", id: "user-message-1" })],
      todos: []
    },
    {
      configurable: {
        run_id: "run-steering-runtime-run-1",
        runtime_operation_kind: "invoke",
        thread_id: "run-steering-harness-runtime-test",
        workspace_path: "/tmp/run-steering-harness-runtime-test"
      }
    }
  )

  assert.equal(observedModelCalls.length, 2)
  assert.equal(observedModelCalls[0]?.length, 1)
  assert.equal(observedModelCalls[1]?.length, 3)
  const injectedMessage = observedModelCalls[1]?.[2]
  assert.ok(HumanMessage.isInstance(injectedMessage))
  assert.equal(injectedMessage.id, "steer-message-1")
  assert.equal(injectedMessage.content, "focus on tests")
})

test("harness runtime resolves mixed entries in order", async () => {
  const observedOrder: string[] = []
  const middleware = createMiddleware({
    name: "PlainMiddleware",
    wrapModelCall: async (request, handler) => {
      observedOrder.push("middleware")
      return handler(request)
    }
  })
  const hook = defineJingleHarnessHook({
    name: "hook",
    phase: "model_call",
    adapterStateKeys: [],
    reads: [],
    runtimeStateKeys: [],
    writes: [],
    writePolicy: "none",
    failureSemantics: "tool",
    observableSignals: ["state"],
    createMiddleware: () =>
      createMiddleware({
        name: "HookMiddleware",
        wrapModelCall: async (request, handler) => {
          observedOrder.push("hook")
          return handler(request)
        }
      })
  })
  const agent = createRuntimeGraphEngine({
    approvalController: testApprovalController,
    callbacks: [],
    checkpointer: new MemorySaver(),
    compaction: unusedCompaction,
    middleware: [hook, middleware],
    model: new FakeToolCallingModel(),
    systemPrompt: "",
    traceConfig: {}
  })

  await agent.invoke(
    {
      contextInclusions: [],
      messages: [new HumanMessage({ content: "hello", id: "user-message-1" })],
      todos: []
    },
    {
      configurable: {
        run_id: "harness-runtime-hook-order-run-1",
        runtime_operation_kind: "invoke",
        thread_id: "harness-runtime-hook-order-test",
        workspace_path: "/tmp/harness-runtime-hook-order-test"
      }
    }
  )

  assert.deepEqual(observedOrder, ["hook", "middleware"])
})
