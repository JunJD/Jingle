import assert from "node:assert/strict"
import test from "node:test"
import { AIMessage, ToolMessage } from "@langchain/core/messages"
import {
  JINGLE_TODO_SYSTEM_PROMPT,
  JINGLE_TODO_TOOL_DESCRIPTION,
  createTodoMiddleware
} from "@jingle/langchain-agent-harness/transitional"

test("jingle todo capability injects attention-anchor todo guidance", async () => {
  const middleware = createTodoMiddleware()
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

  assert.equal(middleware.name, "jingleTodoListMiddleware")
  assert.equal(middleware.tools?.[0]?.name, "write_todos")
  assert.match(observedSystemMessage, /^base prompt/)
  assert.match(observedSystemMessage, /jingle's task attention anchor/)
  assert.match(observedSystemMessage, /visible working memory/)
  assert.match(observedSystemMessage, /Keep exactly one `in_progress` item/)
  assert.match(observedSystemMessage, /completed` only after the required work and verification/)
  assert.match(observedSystemMessage, /Do not stop after writing todos/)
})

test("jingle todo capability keeps stronger progress rules", () => {
  assert.match(JINGLE_TODO_SYSTEM_PROMPT, /Do not call `write_todos` more than once/)
  assert.match(
    JINGLE_TODO_TOOL_DESCRIPTION,
    /active step, remaining work, blockers, and verification/
  )
  assert.match(JINGLE_TODO_TOOL_DESCRIPTION, /keep one in_progress item/)
})

test("jingle todo capability rejects parallel write_todos calls", () => {
  const middleware = createTodoMiddleware()
  const result = middleware.afterModel!(
    {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            { args: {}, id: "todo-call-1", name: "write_todos", type: "tool_call" },
            { args: {}, id: "todo-call-2", name: "write_todos", type: "tool_call" }
          ]
        })
      ]
    },
    {}
  )

  assert.ok(result && typeof result === "object" && "messages" in result)
  const messages = result.messages as unknown[]
  assert.equal(messages.length, 2)
  assert.ok(messages.every((message) => ToolMessage.isInstance(message)))
  assert.deepEqual(
    messages.map((message) => (message as ToolMessage).tool_call_id),
    ["todo-call-1", "todo-call-2"]
  )
  assert.equal((messages[0] as ToolMessage).status, "error")
})
