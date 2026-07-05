import assert from "node:assert/strict"
import test from "node:test"
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages"
import { convertMessagesToResponsesInput } from "@langchain/openai"
import {
  createToolCallConsistencyMiddleware,
  removeOrphanedToolMessages
} from "@jingle/langchain-agent-harness/transitional"

test("removeOrphanedToolMessages removes tool results without prior assistant tool calls", () => {
  const userMessage = new HumanMessage("continue")
  const orphanedToolMessage = new ToolMessage({
    content: "created",
    tool_call_id: "fc_missing"
  })

  assert.deepEqual(removeOrphanedToolMessages([userMessage, orphanedToolMessage]), [userMessage])
})

test("removeOrphanedToolMessages keeps tool results paired with assistant tool calls", () => {
  const userMessage = new HumanMessage("list files")
  const assistantMessage = new AIMessage({
    content: "",
    tool_calls: [
      {
        args: {
          path: "/tmp"
        },
        id: "fc_list",
        name: "ls",
        type: "tool_call"
      }
    ]
  })
  const toolMessage = new ToolMessage({
    content: "[]",
    name: "ls",
    tool_call_id: "fc_list"
  })
  const messages = [userMessage, assistantMessage, toolMessage]

  assert.equal(removeOrphanedToolMessages(messages), messages)
})

test("tool call consistency middleware sanitizes messages before the model handler", async () => {
  const middleware = createToolCallConsistencyMiddleware()
  const userMessage = new HumanMessage("continue")
  const orphanedToolMessage = new ToolMessage({
    content: "orphaned output",
    tool_call_id: "fc_orphaned"
  })

  let observedMessages: unknown[] | null = null
  await middleware.wrapModelCall!(
    {
      messages: [userMessage, orphanedToolMessage]
    } as never,
    async (request) => {
      observedMessages = request.messages
      return new AIMessage("done")
    }
  )

  assert.deepEqual(observedMessages, [userMessage])
})

test("removeOrphanedToolMessages prevents orphaned OpenAI Responses function call outputs", () => {
  const messages = [
    new HumanMessage("continue"),
    new ToolMessage({
      content: "orphaned output",
      tool_call_id: "fc_orphaned"
    })
  ]

  assert.deepEqual(
    convertMessagesToResponsesInput({
      messages,
      model: "gpt-5",
      zdrEnabled: false
    }),
    [
      {
        content: "continue",
        role: "user",
        type: "message"
      },
      {
        call_id: "fc_orphaned",
        id: undefined,
        output: "orphaned output",
        type: "function_call_output"
      }
    ]
  )

  assert.deepEqual(
    convertMessagesToResponsesInput({
      messages: removeOrphanedToolMessages(messages),
      model: "gpt-5",
      zdrEnabled: false
    }),
    [
      {
        content: "continue",
        role: "user",
        type: "message"
      }
    ]
  )
})
