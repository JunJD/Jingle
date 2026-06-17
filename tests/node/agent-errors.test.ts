import assert from "node:assert/strict"
import test from "node:test"
import {
  isAbortLikeError,
  isModelAuthenticationError,
  isTransportInterruptionError,
  normalizeAgentRuntimeError
} from "../../src/main/agent/errors"
import { OpenworkIpcError } from "../../src/main/ipc/error"

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

test("isTransportInterruptionError matches nested fetch termination failures", () => {
  const socketError = new Error("other side closed") as Error & { code?: string }
  socketError.name = "SocketError"
  socketError.code = "UND_ERR_SOCKET"

  const terminated = new TypeError("terminated")
  ;(terminated as TypeError & { cause?: unknown }).cause = socketError

  const middlewareError = new Error("terminated")
  ;(middlewareError as Error & { cause?: unknown }).cause = terminated

  assert.equal(isAbortLikeError(middlewareError), false)
  assert.equal(isTransportInterruptionError(middlewareError), true)
})

test("normalizeAgentRuntimeError converts model transport interruptions to unavailable IPC errors", () => {
  const error = normalizeAgentRuntimeError("agent:invoke", new TypeError("terminated"))

  assert.ok(error instanceof OpenworkIpcError)
  assert.equal(error.channel, "agent:invoke")
  assert.equal(error.code, "UNAVAILABLE")
  assert.equal(error.status, 503)
  assert.equal(error.message, "The agent connection was interrupted. Please retry this run.")
})

test("isModelAuthenticationError matches nested provider authentication failures", () => {
  const providerError = new Error(
    '401 {"error":{"message":"Authentication Fails, Your api key is invalid","type":"authentication_error"}}'
  )
  const wrapped = new Error("MiddlewareError")
  ;(wrapped as Error & { cause?: unknown }).cause = providerError

  assert.equal(isModelAuthenticationError(wrapped), true)
})

test("normalizeAgentRuntimeError converts model auth failures to unauthenticated IPC errors", () => {
  const error = normalizeAgentRuntimeError(
    "agent:invoke",
    new Error("401 authentication_error invalid_api_key")
  )

  assert.ok(error instanceof OpenworkIpcError)
  assert.equal(error.channel, "agent:invoke")
  assert.equal(error.code, "UNAUTHENTICATED")
  assert.equal(error.status, 401)
  assert.equal(error.message, "Authentication failed. Please check your API key in settings.")
})
