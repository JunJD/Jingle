import assert from "node:assert/strict"
import test from "node:test"
import { AIMessage, AIMessageChunk, HumanMessage } from "@langchain/core/messages"
import {
  createTitleMiddleware,
  titleMiddlewareInternals
} from "../../src/main/agent/title-middleware"

type AfterModelTestHook = (state: unknown, runtime: unknown) => unknown | Promise<unknown>

function getAfterModelHook(
  middleware: ReturnType<typeof createTitleMiddleware>
): AfterModelTestHook {
  const hook = middleware.afterModel
  assert.ok(hook)
  return (typeof hook === "function" ? hook : hook.hook) as AfterModelTestHook
}

test("title middleware only generates after the first complete exchange", async () => {
  const middleware = createTitleMiddleware({
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

test("title middleware waits until pending tool calls are resolved", async () => {
  const middleware = createTitleMiddleware({
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

test("title middleware cleans generated output", () => {
  const title = titleMiddlewareInternals.parseTitle(' "<think>ignore</think>  Release notes  " ')

  assert.equal(title, "Release notes")
})

test("title middleware leaves title unset when generation fails", async () => {
  const middleware = createTitleMiddleware({
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
  const prompt = titleMiddlewareInternals.buildTitlePrompt({
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

test("title middleware detects the first user and assistant messages", () => {
  assert.equal(
    titleMiddlewareInternals.shouldGenerateTitle({
      messages: [new HumanMessage("Fix login"), new AIMessage("Got it")],
      title: null
    }),
    true
  )

  assert.equal(
    titleMiddlewareInternals.shouldGenerateTitle({
      messages: [new HumanMessage("Fix login"), new AIMessage("Got it"), new HumanMessage("Next")],
      title: null
    }),
    false
  )

  assert.equal(
    titleMiddlewareInternals.hasTitleBlockingToolCallSignal(
      new AIMessage({
        content: "",
        tool_calls: [{ args: {}, id: "tool-call-1", name: "suggest_personal_memory" }]
      })
    ),
    true
  )
})
