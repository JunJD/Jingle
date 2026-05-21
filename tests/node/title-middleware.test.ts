import assert from "node:assert/strict"
import test from "node:test"
import { AIMessage, HumanMessage } from "@langchain/core/messages"
import { createTitleMiddleware, titleMiddlewareInternals } from "../../src/main/agent/title-middleware"

type AfterModelTestHook = (state: unknown, runtime: unknown) => unknown | Promise<unknown>

function getAfterModelHook(middleware: ReturnType<typeof createTitleMiddleware>): AfterModelTestHook {
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

test("title middleware cleans output and falls back to the first user message", () => {
  const title = titleMiddlewareInternals.parseTitle(' "<think>ignore</think>  Release notes  " ')
  const fallback = titleMiddlewareInternals.fallbackTitle(
    "   Ship the new login flow and verify the onboarding path   "
  )

  assert.equal(title, "Release notes")
  assert.equal(fallback, "Ship the new login flow and verify the onboarding...")
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
})
