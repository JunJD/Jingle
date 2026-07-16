import assert from "node:assert/strict"
import test from "node:test"
import { createWorkspaceFileReferenceUri } from "../../src/shared/composer-reference-uri"
import type { ComposerMessageInput } from "../../src/shared/message-content"
import type { Message } from "../../src/renderer/src/types"
import {
  toComposerAttachmentRef,
  toRestoredAttachmentDraft
} from "../../src/renderer/src/ai-core/useAiAttachments"
import {
  dedupeComposerMetadataRefs,
  getComposerMetadataRefs
} from "../../src/renderer/src/components/chat/useAssistantSelectionRefs"
import {
  buildCurrentComposerMessageInput,
  createComposerHistoryCursor,
  dedupeComposerMessageRefs,
  getComposerAttachmentRefs,
  getComposerHistoryCursorIndex,
  navigateComposerHistory,
  projectComposerHistory
} from "../../src/renderer/src/ai-core/composer-history"

function createMessage(input: Partial<Message> & Pick<Message, "id" | "role">): Message {
  return {
    content: "",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    ...input
  }
}

test("composer history keeps the latest durable user inputs with full refs", () => {
  const messages: Message[] = [
    createMessage({ id: "user-1", role: "user", content: "first" }),
    createMessage({ id: "assistant-1", role: "assistant", content: "answer" }),
    createMessage({ id: "user-2", role: "user", content: "duplicate" }),
    createMessage({ id: "user-3", role: "user", content: "duplicate" }),
    createMessage({
      id: "user-4",
      role: "user",
      content: "latest",
      metadata: {
        refs: [
          {
            name: "spec.md",
            path: "/workspace/spec.md",
            type: "file"
          },
          {
            name: "diagram",
            type: "image",
            url: "data:image/png;base64,AA=="
          },
          {
            extensionName: "github",
            name: "GitHub",
            sourceId: "github",
            type: "extension-source"
          },
          {
            selectedText: "Keep this invariant",
            sourceMessageId: "assistant-1",
            sourceThreadId: "thread-a",
            type: "assistant-message-selection"
          }
        ]
      }
    })
  ]

  assert.deepEqual(projectComposerHistory(messages, 2), [
    {
      refs: [
        {
          name: "spec.md",
          path: "/workspace/spec.md",
          type: "file"
        },
        {
          name: "diagram",
          type: "image",
          url: "data:image/png;base64,AA=="
        },
        {
          extensionName: "github",
          name: "GitHub",
          sourceId: "github",
          type: "extension-source"
        },
        {
          selectedText: "Keep this invariant",
          sourceMessageId: "assistant-1",
          sourceThreadId: "thread-a",
          type: "assistant-message-selection"
        }
      ],
      text: "latest"
    },
    { refs: [], text: "duplicate" }
  ])
})

test("apply and current composer channels round-trip refs without reference text", () => {
  const projectedInput: ComposerMessageInput = {
    refs: [
      {
        extensionName: "github",
        name: "GitHub",
        sourceId: "github",
        type: "extension-source"
      },
      {
        type: "image",
        url: "data:image/png;base64,AA=="
      },
      {
        selectedText: "Keep this invariant",
        sourceMessageId: "assistant-1",
        sourceThreadId: "thread-a",
        type: "assistant-message-selection"
      }
    ],
    text: "Review this context"
  }
  const attachmentRefs = getComposerAttachmentRefs(projectedInput)
  const metadataRefs = getComposerMetadataRefs(projectedInput.refs)

  assert.deepEqual(
    buildCurrentComposerMessageInput({
      attachmentRefs,
      editorRefs: [],
      metadataRefs,
      text: projectedInput.text
    }),
    projectedInput
  )
  assert.deepEqual(
    dedupeComposerMessageRefs([
      ...metadataRefs,
      {
        extensionName: "github",
        name: "Duplicate label",
        sourceId: "github",
        type: "extension-source"
      }
    ]),
    metadataRefs
  )

  const restoredImage = toRestoredAttachmentDraft(attachmentRefs[0]!)
  assert.ok(restoredImage)
  assert.equal(restoredImage.kind, "image")
  assert.equal(restoredImage.name, undefined)
  assert.deepEqual(toComposerAttachmentRef(restoredImage), attachmentRefs[0])
})

test("composer history navigation clears after moving down past the newest entry", () => {
  const entries: ComposerMessageInput[] = [
    { refs: [], text: "latest" },
    { refs: [], text: "older" }
  ]

  assert.deepEqual(navigateComposerHistory({ direction: "up", entries, index: -1 }), {
    entry: { refs: [], text: "latest" },
    index: 0
  })
  assert.deepEqual(navigateComposerHistory({ direction: "up", entries, index: 0 }), {
    entry: { refs: [], text: "older" },
    index: 1
  })
  assert.deepEqual(navigateComposerHistory({ direction: "down", entries, index: 0 }), {
    entry: { refs: [], text: "" },
    index: -1
  })
})

test("composer history cursor resets across thread round-trips and draft replacement", () => {
  const firstThreadA = { kind: "thread", threadId: "thread-a" }
  const threadB = { kind: "thread", threadId: "thread-b" }
  const returnedThreadA = { kind: "thread", threadId: "thread-a" }
  const freshDraft = { kind: "draft" }
  const entries: ComposerMessageInput[] = [
    { refs: [], text: "latest" },
    { refs: [], text: "older" }
  ]

  const browsingThreadA = createComposerHistoryCursor(firstThreadA, 1)
  assert.equal(getComposerHistoryCursorIndex(browsingThreadA, firstThreadA), 1)
  assert.equal(getComposerHistoryCursorIndex(browsingThreadA, threadB), -1)
  assert.equal(getComposerHistoryCursorIndex(browsingThreadA, returnedThreadA), -1)
  assert.equal(getComposerHistoryCursorIndex(browsingThreadA, freshDraft), -1)

  const afterQueuedEdit = createComposerHistoryCursor(returnedThreadA)
  assert.deepEqual(
    navigateComposerHistory({
      direction: "up",
      entries,
      index: getComposerHistoryCursorIndex(afterQueuedEdit, returnedThreadA)
    }),
    {
      entry: { refs: [], text: "latest" },
      index: 0
    }
  )
})

test("composer ref identities do not collide when tuple fields contain separators", () => {
  const collidingUnderConcatenation: ComposerMessageInput["refs"] = [
    {
      extensionName: "github:issues",
      name: "First extension source",
      sourceId: "open",
      type: "extension-source"
    },
    {
      extensionName: "github",
      name: "Second extension source",
      sourceId: "issues:open",
      type: "extension-source"
    },
    {
      selectedText: "selection",
      sourceMessageId: "assistant",
      sourceThreadId: "thread:a",
      type: "assistant-message-selection"
    },
    {
      selectedText: "selection",
      sourceMessageId: "a:assistant",
      sourceThreadId: "thread",
      type: "assistant-message-selection"
    }
  ]

  assert.equal(dedupeComposerMessageRefs(collidingUnderConcatenation).length, 4)
  assert.equal(dedupeComposerMetadataRefs(collidingUnderConcatenation).length, 4)
})

test("inline workspace refs stay in composer text instead of duplicating attachment pills", () => {
  const path = "/workspace/spec.md"
  const input: ComposerMessageInput = {
    refs: [
      { name: "spec.md", path, type: "file" },
      { name: "notes.md", path: "/workspace/notes.md", type: "file" },
      { name: "diagram", type: "image", url: "data:image/png;base64,AA==" }
    ],
    text: `Review [@spec.md](${createWorkspaceFileReferenceUri(path)})`
  }

  assert.deepEqual(getComposerAttachmentRefs(input), [
    { name: "notes.md", path: "/workspace/notes.md", type: "file" },
    { name: "diagram", type: "image", url: "data:image/png;base64,AA==" }
  ])
})
