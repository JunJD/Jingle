import assert from "node:assert/strict"
import test from "node:test"
import { isAbortLikeError } from "../../src/main/agent/errors"

test("isAbortLikeError matches direct abort errors", () => {
  const error = new Error("The operation was aborted.")
  error.name = "AbortError"

  assert.equal(isAbortLikeError(error), true)
})

test("isAbortLikeError matches nested middleware abort causes", () => {
  const nested = new Error("Controller is already closed")
  nested.name = "AbortError"

  const wrapped = new TypeError("terminated")
  ;(wrapped as TypeError & { cause?: unknown }).cause = nested

  const middlewareError = new Error("terminated")
  ;(middlewareError as Error & { cause?: unknown }).cause = wrapped

  assert.equal(isAbortLikeError(middlewareError), true)
})

test("isAbortLikeError honors the active abort signal", () => {
  const controller = new AbortController()
  controller.abort()

  assert.equal(isAbortLikeError(new TypeError("terminated"), controller.signal), true)
})

test("isAbortLikeError keeps non-abort failures visible", () => {
  assert.equal(isAbortLikeError(new Error("socket hang up")), false)
})
