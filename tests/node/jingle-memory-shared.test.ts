import assert from "node:assert/strict"
import test from "node:test"
import { readJingleMemoryEvidenceRefsFromReviewPayload } from "../../src/shared/jingle-memory"

test("memory evidence refs parser accepts only schema-backed context refs", () => {
  const refs = readJingleMemoryEvidenceRefsFromReviewPayload({
    evidenceRefs: [
      {
        id: "ctx:retrieved",
        mode: "retrieved",
        preview: "Retrieved message evidence.",
        sourceId: "message-1",
        sourceType: "history_message",
        target: {
          messageId: "message-1",
          threadId: "thread-1",
          type: "history_message"
        },
        threadId: "thread-1",
        title: "user message"
      },
      {
        id: "ctx:bad-source",
        mode: "retrieved",
        preview: "Bad source evidence.",
        sourceId: "message-2",
        sourceType: "unknown_source",
        target: {
          messageId: "message-2",
          threadId: "thread-1",
          type: "history_message"
        },
        threadId: "thread-1",
        title: "bad source"
      },
      {
        id: "ctx:bad-target",
        mode: "retrieved",
        preview: "Bad target evidence.",
        sourceId: "message-3",
        sourceType: "history_message",
        target: {
          messageId: "message-3",
          threadId: "thread-1",
          type: "unknown_target"
        },
        threadId: "thread-1",
        title: "bad target"
      }
    ]
  })

  assert.deepEqual(refs, [
    {
      id: "ctx:retrieved",
      mode: "retrieved",
      preview: "Retrieved message evidence.",
      sourceId: "message-1",
      sourceType: "history_message",
      target: {
        messageId: "message-1",
        threadId: "thread-1",
        type: "history_message"
      },
      threadId: "thread-1",
      title: "user message"
    }
  ])
})
