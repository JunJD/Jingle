import assert from "node:assert/strict"
import test from "node:test"
import { createComputerUseTransactionId } from "../../src/main/computer-use/transaction-identity"

const TRANSACTION_ID_PATTERN = /^jingle:computer-use:transaction:v1:sha256:[0-9a-f]{64}$/

test("computer-use transaction identity is deterministic, versioned, and opaque", () => {
  const input = { runId: "run-sensitive", toolCallId: "tool-sensitive" }
  const first = createComputerUseTransactionId(input)
  const second = createComputerUseTransactionId(input)

  assert.equal(first, second)
  assert.match(first, TRANSACTION_ID_PATTERN)
  assert.equal(first.includes(input.runId), false)
  assert.equal(first.includes(input.toolCallId), false)
})

test("computer-use transaction identity length-frames both caller ids", () => {
  assert.notEqual(
    createComputerUseTransactionId({ runId: "ab", toolCallId: "c" }),
    createComputerUseTransactionId({ runId: "a", toolCallId: "bc" })
  )
})

test("computer-use transaction identity uses UTF-8 byte limits", () => {
  const withinLimit = "果".repeat(341) + "a"
  const overLimit = "果".repeat(342)

  assert.match(
    createComputerUseTransactionId({ runId: withinLimit, toolCallId: "tool-call" }),
    TRANSACTION_ID_PATTERN
  )
  assert.throws(
    () => createComputerUseTransactionId({ runId: overLimit, toolCallId: "tool-call" }),
    /1024 UTF-8 bytes/
  )
  assert.throws(
    () => createComputerUseTransactionId({ runId: "run", toolCallId: "a".repeat(1_025) }),
    /1024 UTF-8 bytes/
  )
})

test("computer-use transaction identity rejects non-canonical caller ids", () => {
  for (const input of [
    { runId: "", toolCallId: "tool-call" },
    { runId: "run", toolCallId: "" },
    { runId: " run", toolCallId: "tool-call" },
    { runId: "run", toolCallId: "tool-call " }
  ]) {
    assert.throws(() => createComputerUseTransactionId(input), /non-empty canonical string/)
  }
  assert.throws(
    () => createComputerUseTransactionId({ runId: "\ud800", toolCallId: "tool-call" }),
    /valid Unicode/
  )
})
