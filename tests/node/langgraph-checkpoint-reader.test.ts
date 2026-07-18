import assert from "node:assert/strict"
import test from "node:test"
import {
  readJingleLangGraphCheckpointMessages,
  readJingleLangGraphSerializedMessage
} from "../../packages/langchain-agent-harness/src/langgraph-checkpoint-reader"

const invalidContentError = {
  message:
    "[LangGraphCheckpointReader] Serialized message content must be a string or array when present."
}

test("checkpoint reader preserves valid content and message metadata hints", () => {
  const refs = [{ name: "spec.pdf", path: "/tmp/spec.pdf", type: "file" }]
  const additionalKwargs = {
    jingle_composer_text: "Review the specification",
    jingle_user_message_admission: { eventId: "event-1", sequence: 1 },
    refs
  }
  const message = {
    id: ["HumanMessage"],
    kwargs: {
      additional_kwargs: additionalKwargs,
      content: [{ text: "Review the specification", type: "text" }],
      id: "user-1"
    }
  }

  const serialized = readJingleLangGraphSerializedMessage({
    message,
    order: 1,
    rawHash: "raw-hash"
  })
  const [checkpoint] =
    readJingleLangGraphCheckpointMessages({
      checkpoint: { channel_values: { messages: [message] } }
    } as never) ?? []

  assert.deepEqual(serialized.content, [{ text: "Review the specification", type: "text" }])
  assert.deepEqual(checkpoint?.content, serialized.content)
  assert.deepEqual(serialized.metadataHints, {
    admission: { eventId: "event-1", sequence: 1 },
    composerText: "Review the specification",
    refs,
    source: undefined
  })
  assert.deepEqual(checkpoint?.metadataHints, serialized.metadataHints)
})

test("checkpoint reader maps only absent or undefined content to an empty string", () => {
  for (const message of [
    { id: ["HumanMessage"], kwargs: { id: "absent" } },
    { id: ["HumanMessage"], kwargs: { content: undefined, id: "undefined" } }
  ]) {
    assert.equal(
      readJingleLangGraphSerializedMessage({
        message,
        order: 1,
        rawHash: "raw-hash"
      }).content,
      ""
    )
  }
})

test("checkpoint reader fails closed for present malformed content", () => {
  for (const content of [{ unexpected: true }, 42, null, false]) {
    for (const message of [
      { id: ["HumanMessage"], kwargs: { content, id: "user-1" } },
      { content, id: ["HumanMessage"], kwargs: { id: "user-1" } }
    ]) {
      assert.throws(
        () =>
          readJingleLangGraphSerializedMessage({
            message,
            order: 1,
            rawHash: "raw-hash"
          }),
        invalidContentError
      )
      assert.throws(
        () =>
          readJingleLangGraphCheckpointMessages({
            checkpoint: { channel_values: { messages: [message] } }
          } as never),
        invalidContentError
      )
    }
  }
})

test("checkpoint reader validates the selected serialized content owner", () => {
  assert.throws(
    () =>
      readJingleLangGraphSerializedMessage({
        message: {
          content: "top-level fallback",
          id: ["HumanMessage"],
          kwargs: { content: { malformed: true }, id: "user-1" }
        },
        order: 1,
        rawHash: "raw-hash"
      }),
    invalidContentError
  )

  assert.equal(
    readJingleLangGraphSerializedMessage({
      message: {
        content: "top-level fallback",
        id: ["HumanMessage"],
        kwargs: { content: undefined, id: "user-1" }
      },
      order: 1,
      rawHash: "raw-hash"
    }).content,
    "top-level fallback"
  )
})
