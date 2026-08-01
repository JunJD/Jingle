import assert from "node:assert/strict"
import test from "node:test"
import {
  readJingleLangGraphCheckpointMessages,
  readJingleLangGraphSerializedMessage
} from "../../packages/langchain-agent-harness/src/langgraph-checkpoint-reader"
import {
  decodeJingleLangGraphMessagesStreamChunk,
  readJingleLangGraphValuesState
} from "../../packages/langchain-agent-harness/src/langgraph-stream-reader"

const invalidContentError = {
  message:
    "[LangGraphCheckpointReader] Serialized message content must be a string or array when present."
}

function getContentBoundaryReaders(message: unknown): Array<() => unknown> {
  return [
    () =>
      readJingleLangGraphSerializedMessage({
        message,
        order: 1,
        rawHash: "raw-hash"
      }).content,
    () =>
      readJingleLangGraphCheckpointMessages({
        checkpoint: { channel_values: { messages: [message] } }
      } as never)?.[0]?.content,
    () => readJingleLangGraphValuesState({ messages: [message] }).messages?.[0]?.content,
    () => decodeJingleLangGraphMessagesStreamChunk([message]).assistant?.content
  ]
}

function readAllContentBoundaries(message: unknown): unknown[] {
  return getContentBoundaryReaders(message).map((read) => read())
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
    { id: ["AIMessage"], kwargs: { id: "absent" } },
    { id: ["AIMessage"], kwargs: { content: undefined, id: "undefined" } }
  ]) {
    assert.deepEqual(readAllContentBoundaries(message), ["", "", "", ""])
  }
})

test("live and checkpoint readers fail closed for present malformed content", () => {
  for (const content of [{ unexpected: true }, 42, null, false]) {
    for (const message of [
      { id: ["AIMessage"], kwargs: { content, id: "assistant-1" } },
      { content, id: ["AIMessage"], kwargs: { id: "assistant-1" } }
    ]) {
      for (const read of getContentBoundaryReaders(message)) {
        assert.throws(read, invalidContentError)
      }
    }
  }
})

test("live and checkpoint readers share one serialized content owner", () => {
  const malformedKwargs = {
    content: "top-level fallback",
    id: ["AIMessage"],
    kwargs: { content: { malformed: true }, id: "assistant-1" }
  }
  for (const read of getContentBoundaryReaders(malformedKwargs)) {
    assert.throws(read, invalidContentError)
  }

  assert.deepEqual(
    readAllContentBoundaries({
      content: null,
      id: ["AIMessage"],
      kwargs: { content: "kwargs content", id: "assistant-1" }
    }),
    ["kwargs content", "kwargs content", "kwargs content", "kwargs content"]
  )
  assert.deepEqual(
    readAllContentBoundaries({
      content: "top-level fallback",
      id: ["AIMessage"],
      kwargs: { content: undefined, id: "assistant-1" }
    }),
    ["top-level fallback", "top-level fallback", "top-level fallback", "top-level fallback"]
  )
  assert.deepEqual(
    readAllContentBoundaries({
      id: ["AIMessage"],
      lc_kwargs: { content: "lc kwargs content", id: "assistant-1" }
    }),
    ["lc kwargs content", "lc kwargs content", "lc kwargs content", "lc kwargs content"]
  )
})
