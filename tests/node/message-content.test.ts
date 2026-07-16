import test from "node:test"
import assert from "node:assert/strict"
import {
  extractMessageText,
  hasComposerMessageInputContent,
  normalizeComposerMessageRefs,
  parsePersistedMessageContent,
  toMessageContent,
  toComposerMessageInput,
  toAgentMessageContent,
  toAgentMessageContentWithRefs,
  toDisplayAssistantMessageContent,
  toDisplayMessageContent,
  toDisplayUserMessageContent
} from "../../src/shared/message-content"
import { projectMessageContent } from "../../src/renderer/src/lib/message-projection"
import { decodeMessagesStreamPayload } from "../../src/main/agent/agent-stream-codec"
import { extractMessagesFromCheckpoint } from "../../src/main/agent/runtime-state"

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
      name: "spec.pdf",
      source: {
        kind: "text",
        text: "/tmp/spec.pdf"
      },
      type: "file"
    }
  ])
})

test("canonical codec applies role boundaries and recursively unwraps tool results", () => {
  assert.deepEqual(
    toDisplayMessageContent([{ text: "system fact", type: "text" }], { role: "system" }),
    [{ text: "system fact", type: "text" }]
  )
  assert.deepEqual(
    toDisplayMessageContent([{ thinking: "private", type: "thinking" }], { role: "user" }),
    [{ reason: "unsupported", sourceType: "thinking", type: "unrenderable" }]
  )
  assert.deepEqual(
    toDisplayMessageContent(
      [
        {
          content: [
            { text: "created", type: "text" },
            {
              content: [{ text: "nested", type: "text" }],
              tool_use_id: "call-1",
              type: "tool_result"
            }
          ],
          tool_call_id: "call-1",
          type: "tool_result"
        }
      ],
      { role: "tool", toolCallId: "call-1" }
    ),
    [
      { text: "created", type: "text" },
      { text: "nested", type: "text" }
    ]
  )
  assert.deepEqual(
    toDisplayMessageContent([{ content: "result", type: "tool_result" }], { role: "assistant" }),
    [{ reason: "unsupported", sourceType: "tool_result", type: "unrenderable" }]
  )
})

test("canonical codec accepts plain and null-prototype data without executing getters", () => {
  let getterCalls = 0
  const getterBlock = Object.defineProperty({}, "type", {
    enumerable: true,
    get() {
      getterCalls += 1
      return "text"
    }
  })
  const nullPrototypeBlock = Object.assign(Object.create(null) as Record<string, unknown>, {
    text: "safe",
    type: "text"
  })

  assert.deepEqual(toDisplayMessageContent([nullPrototypeBlock], { role: "user" }), [
    { text: "safe", type: "text" }
  ])
  assert.deepEqual(toDisplayMessageContent([getterBlock], { role: "user" }), [
    { reason: "malformed", sourceType: null, type: "unrenderable" }
  ])
  assert.equal(getterCalls, 0)
})

test("composer ref metadata normalization does not execute getters", () => {
  let getterCalls = 0
  const metadata = Object.defineProperty({}, "refs", {
    enumerable: true,
    get() {
      getterCalls += 1
      return [{ name: "secret.txt", path: "/tmp/secret.txt", type: "file" }]
    }
  })
  const ref = Object.defineProperty({}, "type", {
    enumerable: true,
    get() {
      getterCalls += 1
      return "file"
    }
  })

  assert.deepEqual(toComposerMessageInput("safe", metadata), { refs: [], text: "safe" })
  assert.deepEqual(normalizeComposerMessageRefs([ref]), [])
  assert.equal(getterCalls, 0)
})

test("canonical codec rejects sparse, cyclic, bigint, and proxy-backed payloads", () => {
  const sparse: unknown[] = []
  sparse.length = 1
  const cyclic: unknown[] = []
  cyclic.push({ content: cyclic, type: "tool_result" })
  const proxy = new Proxy(
    { text: "hidden", type: "text" },
    {
      getOwnPropertyDescriptor() {
        throw new Error("proxy descriptor trap")
      }
    }
  )
  const revokedData = Proxy.revocable(new Uint8Array([1]), {})
  revokedData.revoke()

  assert.deepEqual(toDisplayMessageContent(sparse, { role: "user" }), [
    { reason: "malformed", sourceType: null, type: "unrenderable" }
  ])
  assert.deepEqual(toDisplayMessageContent(cyclic, { role: "tool" }), [
    { reason: "malformed", sourceType: "tool_result", type: "unrenderable" }
  ])
  assert.deepEqual(toDisplayMessageContent([{ text: BigInt(1), type: "text" }], { role: "user" }), [
    { reason: "malformed", sourceType: "text", type: "unrenderable" }
  ])
  assert.deepEqual(toDisplayMessageContent([proxy], { role: "user" }), [
    { reason: "malformed", sourceType: null, type: "unrenderable" }
  ])
  assert.deepEqual(
    toDisplayMessageContent([{ data: revokedData.proxy, mimeType: "image/png", type: "image" }], {
      role: "user"
    }),
    [{ reason: "malformed", sourceType: "image", type: "unrenderable" }]
  )
})

test("canonical codec normalizes typed image and file source shapes", () => {
  assert.deepEqual(
    toDisplayMessageContent(
      [
        {
          name: "pixel.png",
          source: { data: new Uint8Array([0, 1, 2]), media_type: "image/png", type: "base64" },
          type: "image"
        },
        {
          name: "spec.pdf",
          source: { id: "file-1", media_type: "application/pdf", type: "id" },
          type: "file"
        },
        {
          name: "notes.txt",
          source: { media_type: "text/plain", text: "notes", type: "text" },
          type: "file"
        },
        {
          image_url: { detail: "high", url: "jingle-extension-asset://notion/image.png" },
          name: "asset.png",
          type: "image_url"
        }
      ],
      { role: "user" }
    ),
    [
      {
        name: "pixel.png",
        source: { data: "AAEC", kind: "data", mimeType: "image/png" },
        type: "image"
      },
      {
        name: "spec.pdf",
        source: { fileId: "file-1", kind: "file-id", mimeType: "application/pdf" },
        type: "file"
      },
      {
        name: "notes.txt",
        source: { kind: "text", mimeType: "text/plain", text: "notes" },
        type: "file"
      },
      {
        detail: "high",
        name: "asset.png",
        source: { kind: "url", url: "jingle-extension-asset://notion/image.png" },
        type: "image_url"
      }
    ]
  )
})

test("canonical codec rejects ambiguous carriers and unsafe attachment URLs", () => {
  assert.deepEqual(
    toDisplayMessageContent(
      [
        { data: "AA==", mimeType: "image/png", type: "image", url: "https://example.com/a.png" },
        { image_url: "file:///tmp/private.png", type: "image_url" },
        { content: "javascript:alert(1)", name: "payload", type: "file" }
      ],
      { role: "user" }
    ),
    [
      { reason: "malformed", sourceType: "image", type: "unrenderable" },
      { reason: "malformed", sourceType: "image_url", type: "unrenderable" },
      {
        name: "payload",
        source: { kind: "text", text: "javascript:alert(1)" },
        type: "file"
      }
    ]
  )
})

test("renderer projection only exposes bounded inline images and extension assets for preview", () => {
  const oversizedDataUrl = `data:image/png;base64,${"A".repeat(Math.ceil(((8 * 1024 * 1024 + 1) * 4) / 3))}`
  const projection = projectMessageContent([
    { source: { kind: "url", url: "data:image/png;base64,aW1hZ2U=" }, type: "image" },
    {
      source: { kind: "url", url: "jingle-extension-asset://notion/image.png" },
      type: "image"
    },
    { source: { kind: "url", url: "https://example.com/image.png" }, type: "image" },
    { source: { kind: "url", url: "data:text/html;base64,PHNjcmlwdD4=" }, type: "image" },
    { source: { kind: "url", url: oversizedDataUrl }, type: "image" }
  ])

  assert.deepEqual(
    projection.blocks.map((block) => (block.kind === "attachment" ? block.url : null)),
    [
      "data:image/png;base64,aW1hZ2U=",
      "jingle-extension-asset://notion/image.png",
      null,
      null,
      null
    ]
  )
})

test("stream and checkpoint boundaries project identical recursive tool-result content", () => {
  const rawContent = [
    {
      content: [
        { text: "created", type: "text" },
        {
          name: "result.png",
          source: { data: "aW1hZ2U=", media_type: "image/png", type: "base64" },
          type: "image"
        }
      ],
      tool_use_id: "call-1",
      type: "tool_result"
    }
  ]
  const stream = decodeMessagesStreamPayload(
    [
      {
        id: ["ToolMessage"],
        kwargs: {
          content: rawContent,
          id: "tool-message-1",
          name: "create_image",
          tool_call_id: "call-1"
        },
        type: "tool"
      }
    ],
    null
  )
  const [checkpoint] = extractMessagesFromCheckpoint("thread-1", {
    checkpoint: {
      id: "checkpoint-1",
      channel_values: {
        messages: [
          {
            id: ["ToolMessage"],
            kwargs: {
              content: rawContent,
              id: "tool-message-1",
              name: "create_image",
              tool_call_id: "call-1"
            },
            type: "tool"
          }
        ]
      }
    }
  } as never)

  assert.deepEqual(stream.tool?.content, [
    { text: "created", type: "text" },
    {
      name: "result.png",
      source: { data: "aW1hZ2U=", kind: "data", mimeType: "image/png" },
      type: "image"
    }
  ])
  assert.deepEqual(JSON.parse(checkpoint?.content ?? "null"), stream.tool?.content)
  assert.deepEqual(
    parsePersistedMessageContent(checkpoint?.content ?? "null", {
      role: "tool",
      toolCallId: "call-1"
    }),
    stream.tool?.content
  )
})

test("persisted content parsing fails closed for corrupt and noncanonical payloads", () => {
  const failures: string[] = []
  const options = {
    onInvalid: (reason: "invalid-json" | "noncanonical") => failures.push(reason),
    role: "user" as const
  }

  assert.deepEqual(parsePersistedMessageContent("not-json", options), [
    { reason: "malformed", sourceType: "persisted_message_content", type: "unrenderable" }
  ])
  assert.deepEqual(
    parsePersistedMessageContent(JSON.stringify([{ content: "legacy", type: "text" }]), options),
    [{ reason: "malformed", sourceType: "persisted_message_content", type: "unrenderable" }]
  )
  assert.deepEqual(failures, ["invalid-json", "noncanonical"])
})

test("toDisplayUserMessageContent keeps inline workspace file refs in text only", () => {
  const content = toDisplayUserMessageContent(
    "Review [@src/main/agent/service.ts](jingle-workspace-file://src%2Fmain%2Fagent%2Fservice.ts)",
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
      text: "Review [@src/main/agent/service.ts](jingle-workspace-file://src%2Fmain%2Fagent%2Fservice.ts)",
      type: "text"
    }
  ])
})

test("toDisplayUserMessageContent preserves extension source markdown for renderer viewer", () => {
  const content = toDisplayUserMessageContent(
    "Use [@apple-reminders](jingle-extension-source://apple-reminders/appleReminders) today",
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
      text: "Use [@apple-reminders](jingle-extension-source://apple-reminders/appleReminders) today",
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
  const content = toDisplayAssistantMessageContent([
    {
      thinking: "I should create the reminder.",
      type: "thinking"
    },
    {
      text: "",
      type: "text"
    }
  ])

  assert.deepEqual(content, [
    {
      reasoning: "I should create the reminder.",
      type: "reasoning"
    }
  ])
})

test("toDisplayAssistantMessageContent preserves whitespace-only streamed text blocks", () => {
  assert.deepEqual(
    toDisplayAssistantMessageContent([
      {
        text: " ",
        type: "text"
      },
      {
        content: "\n\n",
        type: "text"
      }
    ]),
    [
      {
        text: " ",
        type: "text"
      },
      {
        text: "\n\n",
        type: "text"
      }
    ]
  )
})
