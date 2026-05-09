import test from "node:test"
import assert from "node:assert/strict"
import {
  extractMessageText,
  stripSerializedToolCallMarkup,
  toComposerMessageInput,
  toDisplayAssistantMessageContent,
  toDisplayUserMessageContent
} from "../../src/shared/message-content"

test("toComposerMessageInput preserves refs from metadata when content is a string", () => {
  const input = toComposerMessageInput("Attached files:\n- spec.pdf", {
    refs: [
      {
        name: "spec.pdf",
        path: "/tmp/spec.pdf",
        type: "file"
      }
    ]
  })

  assert.deepEqual(input, {
    refs: [
      {
        name: "spec.pdf",
        path: "/tmp/spec.pdf",
        type: "file"
      }
    ],
    text: ""
  })
})

test("toDisplayUserMessageContent reconstructs file blocks from metadata refs", () => {
  const content = toDisplayUserMessageContent("Attached files:\n- spec.pdf", {
    refs: [
      {
        name: "spec.pdf",
        path: "/tmp/spec.pdf",
        type: "file"
      }
    ]
  })

  assert.deepEqual(content, [
    {
      content: "/tmp/spec.pdf",
      name: "spec.pdf",
      type: "file"
    }
  ])
})

test("toComposerMessageInput preserves real user text when refs metadata is also present", () => {
  const input = toComposerMessageInput("Please review spec.pdf", {
    refs: [
      {
        name: "spec.pdf",
        path: "/tmp/spec.pdf",
        type: "file"
      }
    ]
  })

  assert.deepEqual(input, {
    refs: [
      {
        name: "spec.pdf",
        path: "/tmp/spec.pdf",
        type: "file"
      }
    ],
    text: "Please review spec.pdf"
  })
})

test("stripSerializedToolCallMarkup removes provider-emitted tool call tags", () => {
  const text =
    "我先创建提醒。\n<function=ext__appleReminders__createReminder> <parameter=title> 本周内整理书桌 <parameter=notes> 清理不需要的文件和物品 </tool_call>"

  assert.equal(
    stripSerializedToolCallMarkup(text, {
      toolNames: ["ext__appleReminders__createReminder"]
    }),
    "我先创建提醒。"
  )
})

test("toDisplayAssistantMessageContent hides raw tool call markup blocks", () => {
  const content = toDisplayAssistantMessageContent(
    [
      {
        text: "<function=ext__appleReminders__createReminder> <parameter=title> 周末去超市采购 </tool_call>",
        type: "text"
      },
      {
        text: "已准备创建。",
        type: "text"
      }
    ],
    {
      toolNames: ["ext__appleReminders__createReminder"]
    }
  )

  assert.deepEqual(content, [
    {
      text: "已准备创建。",
      type: "text"
    }
  ])
})

test("toDisplayAssistantMessageContent preserves unconfirmed tool markup text", () => {
  const content = toDisplayAssistantMessageContent(
    "解释一下 <function=ext__appleReminders__createReminder> 这个格式"
  )

  assert.equal(content, "解释一下 <function=ext__appleReminders__createReminder> 这个格式")
})

test("toDisplayAssistantMessageContent preserves reasoning blocks outside response text", () => {
  const content = toDisplayAssistantMessageContent([
    {
      thinking: "I should inspect the files first.",
      type: "thinking"
    },
    {
      text: "Done.",
      type: "text"
    }
  ])

  assert.deepEqual(content, [
    {
      reasoning: "I should inspect the files first.",
      type: "reasoning"
    },
    {
      text: "Done.",
      type: "text"
    }
  ])
  assert.equal(extractMessageText(content), "Done.")
})

test("toDisplayAssistantMessageContent lifts provider reasoning metadata into display content", () => {
  const content = toDisplayAssistantMessageContent("Final answer.", {
    additional_kwargs: {
      reasoning_content: "Thinking through the request."
    }
  })

  assert.deepEqual(content, [
    {
      reasoning: "Thinking through the request.",
      type: "reasoning"
    },
    {
      text: "Final answer.",
      type: "text"
    }
  ])
  assert.equal(extractMessageText(content), "Final answer.")
})

test("toDisplayAssistantMessageContent strips tool markup while preserving reasoning", () => {
  const content = toDisplayAssistantMessageContent(
    [
      {
        thinking: "I should create the reminder.",
        type: "thinking"
      },
      {
        text: "<function=ext__appleReminders__createReminder> <parameter=title> 周末采购 </tool_call>",
        type: "text"
      }
    ],
    {
      toolNames: ["ext__appleReminders__createReminder"]
    }
  )

  assert.deepEqual(content, [
    {
      reasoning: "I should create the reminder.",
      type: "reasoning"
    }
  ])
})
