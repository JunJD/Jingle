import assert from "node:assert/strict"
import test from "node:test"
import { AIMessage } from "@langchain/core/messages"
import {
  JINGLE_TODO_SYSTEM_PROMPT,
  JINGLE_TODO_TOOL_DESCRIPTION,
  createJingleTodoMiddleware
} from "../../src/main/agent/jingle-todo-middleware"

test("jingle todo middleware injects attention-anchor todo guidance", async () => {
  const middleware = createJingleTodoMiddleware()
  let observedSystemMessage = ""

  await middleware.wrapModelCall!(
    {
      systemMessage: "base prompt"
    } as never,
    async (request) => {
      observedSystemMessage = String((request as { systemMessage?: unknown }).systemMessage ?? "")
      return new AIMessage("done")
    }
  )

  assert.equal(middleware.name, "todoListMiddleware")
  assert.equal(middleware.tools?.[0]?.name, "write_todos")
  assert.match(observedSystemMessage, /^base prompt/)
  assert.match(observedSystemMessage, /jingle's task attention anchor/)
  assert.match(observedSystemMessage, /visible working memory/)
  assert.match(observedSystemMessage, /Keep exactly one `in_progress` item/)
  assert.match(observedSystemMessage, /completed` only after the required work and verification/)
  assert.match(observedSystemMessage, /Do not stop after writing todos/)
})

test("jingle todo tool description keeps stronger progress rules", () => {
  assert.match(JINGLE_TODO_SYSTEM_PROMPT, /Do not call `write_todos` more than once/)
  assert.match(JINGLE_TODO_TOOL_DESCRIPTION, /active step, remaining work, blockers, and verification/)
  assert.match(JINGLE_TODO_TOOL_DESCRIPTION, /keep one in_progress item/)
})
