import assert from "node:assert/strict"
import test from "node:test"
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages"
import { z } from "zod/v4"
import { createSerializedToolCallMiddleware } from "../../src/main/agent/serialized-tool-call-middleware"

const tools = [
  {
    name: "ext__appleReminders__createReminder",
    schema: z.object({
      notes: z.string().optional(),
      title: z.string()
    })
  }
]

const listTools = [
  {
    name: "ext__appleReminders__listReminders",
    schema: z.object({
      includeCompleted: z.boolean().optional(),
      limit: z.number().optional()
    })
  }
]

test("serialized tool call middleware turns provider-emitted function tags into tool calls", async () => {
  const middleware = createSerializedToolCallMiddleware()
  const response = (await middleware.wrapModelCall!(
    {
      tools
    } as never,
    async () =>
      new AIMessage({
        content:
          "<function=ext__appleReminders__createReminder> <parameter=title> 本周内整理书桌 <parameter=notes> 清理不需要的文件和物品 </tool_call>"
      })
  )) as AIMessage

  assert.equal(response.content, "")
  assert.equal(response.tool_calls?.length, 1)
  assert.equal(response.tool_calls?.[0]?.name, "ext__appleReminders__createReminder")
  assert.deepEqual(response.tool_calls?.[0]?.args, {
    notes: "清理不需要的文件和物品",
    title: "本周内整理书桌"
  })
})

test("serialized tool call middleware queues extra serialized tool calls", async () => {
  const middleware = createSerializedToolCallMiddleware()
  const humanMessage = new HumanMessage("创建两个提醒")
  const firstResponse = (await middleware.wrapModelCall!(
    {
      messages: [humanMessage],
      tools
    } as never,
    async () =>
      new AIMessage({
        content:
          "<function=ext__appleReminders__createReminder> <parameter=title> 整理书桌 </tool_call>\n<function=ext__appleReminders__createReminder> <parameter=title> 周末采购 </tool_call>"
      })
  )) as AIMessage

  const firstToolCall = firstResponse.tool_calls?.[0]
  assert.deepEqual(firstToolCall?.args, { title: "整理书桌" })

  let handlerCalled = false
  const secondResponse = (await middleware.wrapModelCall!(
    {
      messages: [
        humanMessage,
        firstResponse,
        new ToolMessage({
          content: "created",
          name: firstToolCall?.name,
          tool_call_id: firstToolCall?.id ?? ""
        })
      ],
      tools
    } as never,
    async () => {
      handlerCalled = true
      return new AIMessage("done")
    }
  )) as AIMessage

  assert.equal(handlerCalled, false)
  assert.deepEqual(secondResponse.tool_calls?.map((toolCall) => toolCall.args), [
    { title: "周末采购" }
  ])
})

test("serialized tool call middleware stops replaying after queued calls finish", async () => {
  const middleware = createSerializedToolCallMiddleware()
  const humanMessage = new HumanMessage("创建两个提醒")
  const firstResponse = (await middleware.wrapModelCall!(
    {
      messages: [humanMessage],
      tools
    } as never,
    async () =>
      new AIMessage({
        content:
          "<function=ext__appleReminders__createReminder> <parameter=title> 整理书桌 </tool_call>\n<function=ext__appleReminders__createReminder> <parameter=title> 周末采购 </tool_call>"
      })
  )) as AIMessage
  const firstToolCall = firstResponse.tool_calls?.[0]
  const secondResponse = (await middleware.wrapModelCall!(
    {
      messages: [
        humanMessage,
        firstResponse,
        new ToolMessage({
          content: "created",
          name: firstToolCall?.name,
          tool_call_id: firstToolCall?.id ?? ""
        })
      ],
      tools
    } as never,
    async () => new AIMessage("should not run")
  )) as AIMessage
  const secondToolCall = secondResponse.tool_calls?.[0]
  let handlerCalled = false

  const finalResponse = (await middleware.wrapModelCall!(
    {
      messages: [
        humanMessage,
        firstResponse,
        new ToolMessage({
          content: "created",
          name: firstToolCall?.name,
          tool_call_id: firstToolCall?.id ?? ""
        }),
        secondResponse,
        new ToolMessage({
          content: "created",
          name: secondToolCall?.name,
          tool_call_id: secondToolCall?.id ?? ""
        })
      ],
      tools
    } as never,
    async () => {
      handlerCalled = true
      return new AIMessage("done")
    }
  )) as AIMessage

  assert.equal(handlerCalled, true)
  assert.equal(finalResponse.content, "done")
  assert.equal(finalResponse.tool_calls?.length ?? 0, 0)
})

test("serialized tool call middleware ignores queued calls before the latest user message", async () => {
  const middleware = createSerializedToolCallMiddleware()
  const firstUserMessage = new HumanMessage("创建两个提醒")
  const firstResponse = (await middleware.wrapModelCall!(
    {
      messages: [firstUserMessage],
      tools
    } as never,
    async () =>
      new AIMessage({
        content:
          "<function=ext__appleReminders__createReminder> <parameter=title> 整理书桌 </tool_call>\n<function=ext__appleReminders__createReminder> <parameter=title> 周末采购 </tool_call>"
      })
  )) as AIMessage
  const firstToolCall = firstResponse.tool_calls?.[0]
  let handlerCalled = false

  const response = (await middleware.wrapModelCall!(
    {
      messages: [
        firstUserMessage,
        firstResponse,
        new ToolMessage({
          content: "created",
          name: firstToolCall?.name,
          tool_call_id: firstToolCall?.id ?? ""
        }),
        new HumanMessage("先别继续，换个任务")
      ],
      tools
    } as never,
    async () => {
      handlerCalled = true
      return new AIMessage("new turn")
    }
  )) as AIMessage

  assert.equal(handlerCalled, true)
  assert.equal(response.content, "new turn")
})

test("serialized tool call middleware preserves string parameters when the schema accepts strings", async () => {
  const middleware = createSerializedToolCallMiddleware()
  const response = (await middleware.wrapModelCall!(
    {
      tools
    } as never,
    async () =>
      new AIMessage({
        content:
          "<function=ext__appleReminders__createReminder> <parameter=title> 123 </tool_call>"
      })
  )) as AIMessage

  assert.deepEqual(response.tool_calls?.[0]?.args, {
    title: "123"
  })
})

test("serialized tool call middleware dedupes tags already present as structured tool calls", async () => {
  const middleware = createSerializedToolCallMiddleware()
  const response = (await middleware.wrapModelCall!(
    {
      tools
    } as never,
    async () =>
      new AIMessage({
        content:
          "<function=ext__appleReminders__createReminder> <parameter=title> 整理书桌 </tool_call>",
        tool_calls: [
          {
            args: {
              title: "整理书桌"
            },
            id: "tool-call-1",
            name: "ext__appleReminders__createReminder",
            type: "tool_call"
          }
        ]
      })
  )) as AIMessage

  assert.equal(response.tool_calls?.length, 1)
  assert.equal(response.tool_calls?.[0]?.id, "tool-call-1")
  assert.equal(response.content, "")
})

test("serialized tool call middleware preserves native structured parallel tool calls", async () => {
  const middleware = createSerializedToolCallMiddleware()
  const response = (await middleware.wrapModelCall!(
    {
      tools
    } as never,
    async () =>
      new AIMessage({
        content: "",
        tool_calls: [
          {
            args: {
              title: "整理书桌"
            },
            id: "tool-call-1",
            name: "ext__appleReminders__createReminder",
            type: "tool_call"
          },
          {
            args: {
              title: "周末采购"
            },
            id: "tool-call-2",
            name: "ext__appleReminders__createReminder",
            type: "tool_call"
          }
        ]
      })
  )) as AIMessage

  assert.equal(response.tool_calls?.length, 2)
  assert.equal(response.tool_calls?.[0]?.id, "tool-call-1")
  assert.equal(response.tool_calls?.[1]?.id, "tool-call-2")
})

test("serialized tool call middleware parses parameter values against the tool schema", async () => {
  const middleware = createSerializedToolCallMiddleware()
  const response = (await middleware.wrapModelCall!(
    {
      tools: listTools
    } as never,
    async () =>
      new AIMessage({
        content:
          "<function=ext__appleReminders__listReminders> <parameter=includeCompleted> true <parameter=limit> 25 </tool_call>"
      })
  )) as AIMessage

  assert.deepEqual(response.tool_calls?.[0]?.args, {
    includeCompleted: true,
    limit: 25
  })
})
