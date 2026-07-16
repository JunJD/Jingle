import assert from "node:assert/strict"
import test from "node:test"
import { AIMessage, AIMessageChunk, HumanMessage } from "@langchain/core/messages"
import { MemorySaver } from "@langchain/langgraph"
import { FakeToolCallingModel } from "langchain"
import {
  buildJingleTitlePrompt,
  createJingleTitleGenerator,
  hasJingleLangChainToolCallSignal,
  parseJingleGeneratedTitle,
  shouldGenerateJingleTitle
} from "@jingle/langchain-agent-harness/transitional"
import {
  createRuntimeGraphEngine,
  TitleProjectionNode
} from "../../packages/langchain-agent-harness/src/harness-runtime"
import type { RuntimeApprovalControllerContract } from "../../packages/langchain-agent-harness/src/runtime-contract"
import type { RuntimeProjectionFailure } from "../../packages/langchain-agent-harness/src/runtime-observation"

const testApprovalController: RuntimeApprovalControllerContract = {
  allowedDecisions: ["approve", "user_declined", "corrected"],
  policyRuntime: {
    evaluate: () => ({ args: {}, disposition: "allow" })
  }
}

test("title projection generates after the first complete exchange", async () => {
  const node = new TitleProjectionNode(async () => "AI title")

  const firstTurn = await node.invoke({
    messages: [new HumanMessage("Fix login"), new AIMessage("Got it")],
    title: null
  })
  const secondTurn = await node.invoke({
    messages: [
      new HumanMessage("Fix login"),
      new AIMessage("Got it"),
      new HumanMessage("Add logout")
    ],
    title: null
  })
  const existingTitleTurn = await node.invoke({
    messages: [new HumanMessage("Fix login"), new AIMessage("Got it")],
    title: "Existing title"
  })

  assert.deepEqual(firstTurn, { stateUpdate: { title: "AI title" } })
  assert.deepEqual(secondTurn, {})
  assert.deepEqual(existingTitleTurn, {})
})

test("title projection waits until pending tool calls are resolved", async () => {
  const node = new TitleProjectionNode(async () => "AI title")

  const afterToolRequest = await node.invoke({
    messages: [
      new HumanMessage("Remember this"),
      new AIMessage({
        content: "",
        tool_calls: [{ args: {}, id: "tool-call-1", name: "suggest_personal_memory" }]
      })
    ],
    title: null
  })
  const afterFinalAssistantText = await node.invoke({
    messages: [
      new HumanMessage("Remember this"),
      new AIMessage({
        content: "",
        tool_calls: [{ args: {}, id: "tool-call-1", name: "suggest_personal_memory" }]
      }),
      new AIMessageChunk("Saved")
    ],
    title: null
  })

  assert.deepEqual(afterToolRequest, {})
  assert.deepEqual(afterFinalAssistantText, { stateUpdate: { title: "AI title" } })
})

test("title generation output is cleaned", () => {
  const title = parseJingleGeneratedTitle(' "<think>ignore</think>  Release notes  " ')

  assert.equal(title, "Release notes")
})

test("title projection leaves title unset when generation returns no title", async () => {
  const node = new TitleProjectionNode(async () => null)

  const result = await node.invoke({
    messages: [new HumanMessage("Fix login"), new AIMessage("Got it")],
    title: null
  })

  assert.deepEqual(result, {})
})

test("title projection reports generator failure and remains retryable", async () => {
  const failure = new Error("title provider failed")
  const failures: RuntimeProjectionFailure[] = []
  let attempts = 0
  const node = new TitleProjectionNode(
    async () => {
      attempts += 1
      if (attempts === 1) throw failure
      return "Recovered title"
    },
    (event) => failures.push(event)
  )
  const input = {
    messages: [new HumanMessage("Fix login"), new AIMessage("Got it")],
    title: null
  }

  assert.deepEqual(await node.invoke(input), {})
  assert.deepEqual(await node.invoke(input), { stateUpdate: { title: "Recovered title" } })
  assert.deepEqual(failures, [{ error: failure, projection: "title" }])
})

test("title prompt is based on the first user message only", () => {
  const prompt = buildJingleTitlePrompt({
    messages: [
      new HumanMessage("Summarize the authentication bug"),
      new AIMessage("The implementation uses OAuth callbacks and retries.")
    ],
    title: null
  })

  assert.match(prompt.system, /Generate a short title/)
  assert.match(prompt.prompt, /Summarize the authentication bug/)
  assert.doesNotMatch(prompt.prompt, /OAuth callbacks/)
})

test("title policy detects complete user and assistant exchanges", () => {
  assert.equal(
    shouldGenerateJingleTitle({
      messages: [new HumanMessage("Fix login"), new AIMessage("Got it")],
      title: null
    }),
    true
  )

  assert.equal(
    shouldGenerateJingleTitle({
      messages: [new HumanMessage("Fix login"), new AIMessage("Got it"), new HumanMessage("Next")],
      title: null
    }),
    false
  )

  assert.equal(
    hasJingleLangChainToolCallSignal(
      new AIMessage({
        content: "",
        tool_calls: [{ args: {}, id: "tool-call-1", name: "suggest_personal_memory" }]
      })
    ),
    true
  )
})

test("title projection is an explicit runtime graph node", () => {
  const node = new TitleProjectionNode(async () => "AI title")

  assert.equal(node.kind, "TitleProjectionNode")
  assert.equal(node.boundary, "projection")
})

test("runtime graph persists title projection after the model step", async () => {
  const generatedFrom: string[][] = []
  const graph = createRuntimeGraphEngine({
    approvalController: testApprovalController,
    callbacks: [],
    checkpointer: new MemorySaver(),
    memoryRecordingProjectionEnabled: false,
    middleware: [],
    model: new FakeToolCallingModel(),
    systemPrompt: "",
    titleGenerator: async (state) => {
      generatedFrom.push(state.messages.map((message) => String(message.content)))
      return "Graph title"
    },
    traceConfig: {}
  })
  const config = {
    configurable: {
      run_id: "runtime-title-projection-run-1",
      runtime_operation_kind: "invoke",
      thread_id: "runtime-title-projection-thread",
      workspace_path: "/tmp/runtime-title-projection-thread"
    }
  }

  await graph.invoke(
    {
      contextInclusions: [],
      messages: [new HumanMessage({ content: "Fix login", id: "user-message-1" })],
      todos: []
    },
    config
  )

  const checkpoint = await graph.getState<{ title?: string }>(config)
  assert.equal(checkpoint.values.title, "Graph title")
  assert.equal(generatedFrom.length, 1)
  assert.equal(generatedFrom[0]?.[0], "Fix login")
  assert.equal(generatedFrom[0]?.length, 2)
})

test("runtime graph isolates title projection failures from the core result", async () => {
  const failure = new Error("title provider failed")
  const failures: RuntimeProjectionFailure[] = []
  const graph = createRuntimeGraphEngine({
    approvalController: testApprovalController,
    callbacks: [],
    checkpointer: new MemorySaver(),
    memoryRecordingProjectionEnabled: false,
    middleware: [],
    model: new FakeToolCallingModel(),
    observeProjectionFailure: (event) => failures.push(event),
    systemPrompt: "",
    titleGenerator: createJingleTitleGenerator({
      createModel: () => ({
        withConfig: () => ({
          invoke: async () => {
            throw failure
          }
        })
      }),
      timeoutMs: 1
    }),
    traceConfig: {}
  })
  const config = {
    configurable: {
      run_id: "runtime-title-projection-failure-run",
      runtime_operation_kind: "invoke",
      thread_id: "runtime-title-projection-failure-thread",
      workspace_path: "/tmp/runtime-title-projection-failure-thread"
    }
  }

  await graph.invoke(
    {
      contextInclusions: [],
      messages: [new HumanMessage({ content: "Fix login", id: "user-message-1" })],
      todos: []
    },
    config
  )

  const checkpoint = await graph.getState<{ messages: unknown[]; title?: string }>(config)
  assert.equal(checkpoint.values.messages.length, 2)
  assert.equal(checkpoint.values.title, undefined)
  assert.deepEqual(failures, [{ error: failure, projection: "title" }])
})
