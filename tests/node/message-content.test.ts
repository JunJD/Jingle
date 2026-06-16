import test from "node:test"
import assert from "node:assert/strict"
import {
  extractMessageText,
  hasComposerMessageInputContent,
  normalizeComposerMessageRefs,
  toMessageContent,
  toComposerMessageInput,
  toAgentMessageContent,
  toAgentMessageContentWithRefs,
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

test("extension source refs round-trip through metadata without becoming visible attachments", () => {
  const refs = normalizeComposerMessageRefs([
    {
      type: "extension-source",
      extensionName: "  apple-reminders  ",
      name: "  Apple Reminders  ",
      sourceId: "  appleReminders  "
    }
  ])

  assert.deepEqual(refs, [
    {
      extensionName: "apple-reminders",
      name: "Apple Reminders",
      sourceId: "appleReminders",
      type: "extension-source"
    }
  ])
  assert.equal(hasComposerMessageInputContent({ refs, text: "" }), false)
  assert.deepEqual(toMessageContent({ refs, text: "@apple-reminders remind me" }), [
    {
      text: "@apple-reminders remind me",
      type: "text"
    }
  ])
})

test("image refs become base64 image_url blocks for model invocation", () => {
  const dataUrl = "data:image/png;base64,aW1hZ2U="
  const displayContent = toMessageContent({
    refs: [
      {
        name: "clipboard.png",
        type: "image",
        url: dataUrl
      }
    ],
    text: "describe it"
  })

  const agentContent = toAgentMessageContent(displayContent)

  assert.deepEqual(agentContent, [
    {
      text: "describe it",
      type: "text"
    },
    {
      image_url: {
        url: dataUrl
      },
      name: "clipboard.png",
      type: "image_url"
    }
  ])
})

test("assistant message selection refs are metadata refs and model-only context", () => {
  const refs = normalizeComposerMessageRefs([
    {
      type: "assistant-message-selection",
      selectedText: "  snapshot should not own runtime facts  ",
      sourceMessageId: "  assistant-message-1  ",
      sourceThreadId: "  thread-1  "
    }
  ])
  const displayContent = toMessageContent({
    refs,
    text: "Is this still true?"
  })
  const agentContent = toAgentMessageContentWithRefs(displayContent, refs)

  assert.deepEqual(refs, [
    {
      selectedText: "snapshot should not own runtime facts",
      sourceMessageId: "assistant-message-1",
      sourceThreadId: "thread-1",
      type: "assistant-message-selection"
    }
  ])
  assert.equal(hasComposerMessageInputContent({ refs, text: "" }), false)
  assert.deepEqual(displayContent, [
    {
      text: "Is this still true?",
      type: "text"
    }
  ])
  assert.equal(
    agentContent,
    [
      "Is this still true?",
      "",
      "Referenced assistant selections:",
      "1. snapshot should not own runtime facts"
    ].join("\n")
  )
  assert.deepEqual(toDisplayUserMessageContent(agentContent, { refs }), [
    {
      text: "Is this still true?",
      type: "text"
    }
  ])
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

test("toDisplayUserMessageContent keeps inline workspace file refs in text only", () => {
  const content = toDisplayUserMessageContent(
    "Review [@src/main/agent/service.ts](openwork-workspace-file://src%2Fmain%2Fagent%2Fservice.ts)",
    {
      refs: [
        {
          name: "service.ts",
          path: "src/main/agent/service.ts",
          type: "file"
        }
      ]
    }
  )

  assert.deepEqual(content, [
    {
      text: "Review [@src/main/agent/service.ts](openwork-workspace-file://src%2Fmain%2Fagent%2Fservice.ts)",
      type: "text"
    }
  ])
})

test("toDisplayUserMessageContent preserves extension source markdown for renderer viewer", () => {
  const content = toDisplayUserMessageContent(
    "Use [@apple-reminders](openwork-extension-source://apple-reminders/appleReminders) today",
    {
      refs: [
        {
          extensionName: "apple-reminders",
          name: "Apple Reminders",
          sourceId: "appleReminders",
          type: "extension-source"
        }
      ]
    }
  )

  assert.deepEqual(content, [
    {
      text: "Use [@apple-reminders](openwork-extension-source://apple-reminders/appleReminders) today",
      type: "text"
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

test("toDisplayAssistantMessageContent drops empty text while preserving reasoning", () => {
  const content = toDisplayAssistantMessageContent(
    [
      {
        thinking: "I should create the reminder.",
        type: "thinking"
      },
      {
        text: "",
        type: "text"
      }
    ]
  )

  assert.deepEqual(content, [
    {
      reasoning: "I should create the reminder.",
      type: "reasoning"
    }
  ])
})
