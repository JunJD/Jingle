import assert from "node:assert/strict"
import test from "node:test"
import { AIMessage, AIMessageChunk, HumanMessage } from "@langchain/core/messages"
import {
  buildJingleTitlePrompt,
  createJingleTitleHook,
  hasJingleLangChainToolCallSignal,
  parseJingleGeneratedTitle,
  shouldGenerateJingleTitle
} from "@jingle/langchain-agent-harness/transitional"
import { compileRuntimeHookToMiddleware } from "../../packages/langchain-agent-harness/src/harness-runtime"

type AfterModelTestHook = (state: unknown, runtime: unknown) => unknown | Promise<unknown>

function getAfterModelHook(
  middleware: ReturnType<typeof compileRuntimeHookToMiddleware>
): AfterModelTestHook {
  const hook = middleware.afterModel
  assert.ok(hook)
  return (typeof hook === "function" ? hook : hook.hook) as AfterModelTestHook
}

function createTitleRuntimeMiddleware(options: Parameters<typeof createJingleTitleHook>[0]) {
  return compileRuntimeHookToMiddleware(createJingleTitleHook(options))
}

test("title capability only generates after the first complete exchange", async () => {
  const middleware = createTitleRuntimeMiddleware({
    generateTitle: async () => "AI title"
  })
  const afterModel = getAfterModelHook(middleware)

  const firstTurn = await afterModel(
    {
      messages: [new HumanMessage("Fix login"), new AIMessage("Got it")],
      title: null
    },
    {}
  )
  const secondTurn = await afterModel(
    {
      messages: [
        new HumanMessage("Fix login"),
        new AIMessage("Got it"),
        new HumanMessage("Add logout")
      ],
      title: null
    },
    {}
  )
  const existingTitleTurn = await afterModel(
    {
      messages: [new HumanMessage("Fix login"), new AIMessage("Got it")],
      title: "Existing title"
    },
    {}
  )

  assert.deepEqual(firstTurn, { title: "AI title" })
  assert.equal(secondTurn, undefined)
  assert.equal(existingTitleTurn, undefined)
})

test("title capability waits until pending tool calls are resolved", async () => {
  const middleware = createTitleRuntimeMiddleware({
    generateTitle: async () => "AI title"
  })
  const afterModel = getAfterModelHook(middleware)

  const afterToolRequest = await afterModel(
    {
      messages: [
        new HumanMessage("Remember this"),
        new AIMessage({
          content: "",
          tool_calls: [{ args: {}, id: "tool-call-1", name: "suggest_personal_memory" }]
        })
      ],
      title: null
    },
    {}
  )
  const afterFinalAssistantText = await afterModel(
    {
      messages: [
        new HumanMessage("Remember this"),
        new AIMessage({
          content: "",
          tool_calls: [{ args: {}, id: "tool-call-1", name: "suggest_personal_memory" }]
        }),
        new AIMessageChunk("Saved")
      ],
      title: null
    },
    {}
  )

  assert.equal(afterToolRequest, undefined)
  assert.deepEqual(afterFinalAssistantText, { title: "AI title" })
})

test("title capability cleans generated output", () => {
  const title = parseJingleGeneratedTitle(' "<think>ignore</think>  Release notes  " ')

  assert.equal(title, "Release notes")
})

test("title capability leaves title unset when generation fails", async () => {
  const middleware = createTitleRuntimeMiddleware({
    generateTitle: async () => null
  })
  const afterModel = getAfterModelHook(middleware)

  const result = await afterModel(
    {
      messages: [new HumanMessage("Fix login"), new AIMessage("Got it")],
      title: null
    },
    {}
  )

  assert.equal(result, undefined)
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

test("title capability detects the first user and assistant messages", () => {
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

test("title capability runtime adapter is owned by langchain harness", () => {
  const middleware = createTitleRuntimeMiddleware({
    generateTitle: async () => "AI title"
  })

  assert.equal(middleware.name, "TitleMiddleware")
  assert.ok(middleware.stateSchema)
})
