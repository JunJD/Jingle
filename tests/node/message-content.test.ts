import test from "node:test"
import assert from "node:assert/strict"
import {
  toComposerMessageInput,
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
