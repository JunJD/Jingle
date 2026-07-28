import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import { attachNativeHelperStdinErrorHandler } from "../../src/main/services/native-helper-stdin"

test("native helper stdin errors are consumed and reported only for the live owner", () => {
  const stdin = new EventEmitter()
  const errors: unknown[] = []
  let isCurrent = true
  attachNativeHelperStdinErrorHandler(stdin, {
    isCurrent: () => isCurrent,
    onUnexpectedError: (error) => errors.push(error)
  })

  const liveError = Object.assign(new Error("write EPIPE"), { code: "EPIPE" })
  assert.doesNotThrow(() => stdin.emit("error", liveError))
  assert.deepEqual(errors, [liveError])
  assert.doesNotThrow(() => stdin.emit("error", new Error("duplicate live error")))
  assert.deepEqual(errors, [liveError])

  isCurrent = false
  assert.doesNotThrow(() => stdin.emit("error", new Error("expected shutdown")))
  assert.deepEqual(errors, [liveError])
})

test("native helper stdin observation failures cannot become main process failures", () => {
  const stdin = new EventEmitter()
  attachNativeHelperStdinErrorHandler(stdin, {
    isCurrent: () => true,
    onUnexpectedError: () => {
      throw new Error("diagnostics unavailable")
    }
  })

  const fallbackErrors: unknown[][] = []
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => fallbackErrors.push(args)
  try {
    assert.doesNotThrow(() => stdin.emit("error", new Error("write EPIPE")))
  } finally {
    console.error = originalConsoleError
  }
  assert.equal(fallbackErrors.length, 1)
})
