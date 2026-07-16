import assert from "node:assert/strict"
import test from "node:test"
import { HumanMessage } from "@langchain/core/messages"
import { MemorySaver } from "@langchain/langgraph"
import { createMiddleware, FakeToolCallingModel } from "langchain"
import { jingleAgentContextInclusionsStateSchema } from "@jingle/langchain-agent-harness/transitional"
import {
  createRuntimeGraphEngine,
  MemoryRecordingProjectionNode
} from "../../packages/langchain-agent-harness/src/harness-runtime"
import type { JingleContextInclusionStateItem } from "../../packages/langchain-agent-harness/src/context-inclusion-state"
import type { RuntimeApprovalControllerContract } from "../../packages/langchain-agent-harness/src/runtime-contract"
import type { RuntimeProjectionFailure } from "../../packages/langchain-agent-harness/src/runtime-observation"
import type { RuntimeRecordingRef } from "../../packages/langchain-agent-harness/src/runtime-state"

const testApprovalController: RuntimeApprovalControllerContract = {
  allowedDecisions: ["approve", "user_declined", "corrected"],
  policyRuntime: {
    evaluate: () => ({ args: {}, disposition: "allow" })
  }
}

function createMemoryInclusion(
  input: Partial<Record<string, unknown>> = {}
): JingleContextInclusionStateItem & Record<string, unknown> {
  return {
    availability: "available",
    createdAt: 1_700_000_000_000,
    id: "memory-inclusion-1",
    mode: "provided",
    runId: "run-1",
    sourceType: "memory",
    target: { memoryId: "memory-1" },
    threadId: "thread-1",
    ...input
  }
}

const traceRecordingRef: RuntimeRecordingRef = {
  createdAt: "2026-07-11T00:00:00.000Z",
  domain: "agent_trace",
  path: null,
  refId: "trace-1",
  runId: "run-1",
  threadId: "thread-1"
}

function createGraph(input: {
  memoryRecordingProjectionEnabled: boolean
  middleware: Parameters<typeof createRuntimeGraphEngine>[0]["middleware"]
  observeProjectionFailure?: (failure: RuntimeProjectionFailure) => void
}) {
  return createRuntimeGraphEngine({
    approvalController: testApprovalController,
    callbacks: [],
    checkpointer: new MemorySaver(),
    memoryRecordingProjectionEnabled: input.memoryRecordingProjectionEnabled,
    middleware: input.middleware,
    model: new FakeToolCallingModel(),
    observeProjectionFailure: input.observeProjectionFailure,
    systemPrompt: "",
    titleGenerator: async () => null,
    traceConfig: {}
  })
}

test("memory recording projection emits deduplicated provided memory refs", () => {
  const node = new MemoryRecordingProjectionNode()

  const result = node.invoke({
    contextInclusions: [
      createMemoryInclusion(),
      createMemoryInclusion({ id: "memory-inclusion-duplicate" }),
      createMemoryInclusion({ id: "retrieved-memory", mode: "retrieved" }),
      { id: "workspace-file" }
    ]
  })

  assert.deepEqual(result, {
    stateUpdate: {
      recordingRefs: [
        {
          createdAt: "2023-11-14T22:13:20.000Z",
          domain: "memory",
          path: null,
          refId: "memory-1",
          runId: "run-1",
          threadId: "thread-1"
        }
      ]
    }
  })
})

test("memory recording projection reports malformed facts and remains rebuildable", () => {
  const failures: RuntimeProjectionFailure[] = []
  const node = new MemoryRecordingProjectionNode((failure) => failures.push(failure))

  assert.deepEqual(
    node.invoke({
      contextInclusions: [createMemoryInclusion({ target: {} })]
    }),
    {}
  )
  assert.deepEqual(node.invoke({ contextInclusions: [createMemoryInclusion()] }), {
    stateUpdate: {
      recordingRefs: [
        {
          createdAt: "2023-11-14T22:13:20.000Z",
          domain: "memory",
          path: null,
          refId: "memory-1",
          runId: "run-1",
          threadId: "thread-1"
        }
      ]
    }
  })
  assert.equal(failures.length, 1)
  assert.equal(failures[0]?.projection, "memory-recording")
  assert.match(String(failures[0]?.error), /requires target\.memoryId/)
})

test("memory recording projection is a no-op without provided memory", () => {
  const node = new MemoryRecordingProjectionNode()

  assert.deepEqual(node.invoke({ contextInclusions: [{ id: "workspace-file" }] }), {})
  assert.equal(node.kind, "MemoryRecordingProjectionNode")
  assert.equal(node.boundary, "projection")
})

test("runtime graph projects memory after legacy afterAgent updates", async () => {
  const appendMemoryAtExit = createMiddleware({
    name: "AppendMemoryAtExit",
    stateSchema: jingleAgentContextInclusionsStateSchema,
    afterAgent: () => ({ contextInclusions: [createMemoryInclusion()] })
  })
  const graph = createGraph({
    memoryRecordingProjectionEnabled: true,
    middleware: [appendMemoryAtExit]
  })
  const config = {
    configurable: {
      run_id: "memory-projection-run-1",
      runtime_operation_kind: "invoke",
      thread_id: "memory-projection-thread",
      workspace_path: "/tmp/memory-projection-thread"
    }
  }

  await graph.invoke(
    {
      contextInclusions: [],
      messages: [new HumanMessage({ content: "hello", id: "user-message-1" })],
      recordingRefs: [traceRecordingRef],
      todos: []
    },
    config
  )

  const checkpoint = await graph.getState<{ recordingRefs: RuntimeRecordingRef[] }>(config)
  assert.deepEqual(
    checkpoint.values.recordingRefs.map((recordingRef) => recordingRef.domain),
    ["agent_trace", "memory"]
  )
})

test("runtime graph omits memory projection when the run capability is disabled", async () => {
  const appendMemoryAtExit = createMiddleware({
    name: "AppendMemoryAtExit",
    stateSchema: jingleAgentContextInclusionsStateSchema,
    afterAgent: () => ({ contextInclusions: [createMemoryInclusion()] })
  })
  const graph = createGraph({
    memoryRecordingProjectionEnabled: false,
    middleware: [appendMemoryAtExit]
  })
  const config = {
    configurable: {
      run_id: "memory-projection-disabled-run-1",
      runtime_operation_kind: "invoke",
      thread_id: "memory-projection-disabled-thread",
      workspace_path: "/tmp/memory-projection-disabled-thread"
    }
  }

  await graph.invoke(
    {
      contextInclusions: [],
      messages: [new HumanMessage({ content: "hello", id: "user-message-1" })],
      recordingRefs: [traceRecordingRef],
      todos: []
    },
    config
  )

  const checkpoint = await graph.getState<{ recordingRefs: RuntimeRecordingRef[] }>(config)
  assert.deepEqual(checkpoint.values.recordingRefs, [traceRecordingRef])
})

test("runtime graph isolates memory projection failures from the core result", async () => {
  const failures: RuntimeProjectionFailure[] = []
  const appendMalformedMemoryAtExit = createMiddleware({
    name: "AppendMalformedMemoryAtExit",
    stateSchema: jingleAgentContextInclusionsStateSchema,
    afterAgent: () => ({ contextInclusions: [createMemoryInclusion({ target: {} })] })
  })
  const graph = createGraph({
    memoryRecordingProjectionEnabled: true,
    middleware: [appendMalformedMemoryAtExit],
    observeProjectionFailure: (failure) => failures.push(failure)
  })
  const config = {
    configurable: {
      run_id: "memory-projection-failure-run",
      runtime_operation_kind: "invoke",
      thread_id: "memory-projection-failure-thread",
      workspace_path: "/tmp/memory-projection-failure-thread"
    }
  }

  await graph.invoke(
    {
      contextInclusions: [],
      messages: [new HumanMessage({ content: "hello", id: "user-message-1" })],
      recordingRefs: [traceRecordingRef],
      todos: []
    },
    config
  )

  const checkpoint = await graph.getState<{
    messages: unknown[]
    recordingRefs: RuntimeRecordingRef[]
  }>(config)
  assert.equal(checkpoint.values.messages.length, 2)
  assert.deepEqual(checkpoint.values.recordingRefs, [traceRecordingRef])
  assert.equal(failures.length, 1)
  assert.equal(failures[0]?.projection, "memory-recording")
  assert.match(String(failures[0]?.error), /requires target\.memoryId/)
})
