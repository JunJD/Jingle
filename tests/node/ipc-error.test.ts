import assert from "node:assert/strict"
import test from "node:test"
import {
  buildIpcErrorPayload,
  buildSerializedIpcErrorMessage,
  JingleIpcError
} from "../../src/main/ipc/error"
import { normalizeInvokeError, JingleIpcClientError } from "../../src/preload/ipc-errors"
import {
  extractIpcErrorPayload,
  getIpcErrorStatus,
  parseSerializedIpcErrorMessage,
  serializeIpcErrorPayload
} from "../../src/shared/ipc-error"

test("serializeIpcErrorPayload round-trips through the shared parser", () => {
  const serialized = serializeIpcErrorPayload({
    channel: "threads:get",
    code: "NOT_FOUND",
    details: ["thread_id: missing"],
    message: "Thread was not found.",
    status: 404
  })

  assert.deepEqual(parseSerializedIpcErrorMessage(serialized), {
    channel: "threads:get",
    code: "NOT_FOUND",
    details: ["thread_id: missing"],
    message: "Thread was not found.",
    status: 404
  })
})

test("extractIpcErrorPayload reads structured errors from Error instances", () => {
  const error = new Error(
    serializeIpcErrorPayload({
      code: "FAILED_PRECONDITION",
      message: "Workspace path is required.",
      status: 412
    })
  )

  assert.deepEqual(extractIpcErrorPayload(error), {
    code: "FAILED_PRECONDITION",
    message: "Workspace path is required.",
    status: 412
  })
})

test("buildIpcErrorPayload maps validation-style failures to invalid argument", () => {
  const payload = buildIpcErrorPayload(
    "agent:resume",
    new JingleIpcError({
      channel: "agent:resume",
      code: "INVALID_ARGUMENT",
      details: ["decision.request_id: required"],
      message: "agent:resume params validation failed. decision.request_id: required"
    })
  )

  assert.deepEqual(payload, {
    channel: "agent:resume",
    code: "INVALID_ARGUMENT",
    details: ["decision.request_id: required"],
    message: "agent:resume params validation failed. decision.request_id: required",
    status: 400
  })
})

test("buildSerializedIpcErrorMessage preserves explicit IPC codes", () => {
  const serialized = buildSerializedIpcErrorMessage(
    "agent:resume",
    new JingleIpcError({
      channel: "agent:resume",
      code: "CONFLICT",
      message: "HITL request is already resolved."
    })
  )

  assert.deepEqual(parseSerializedIpcErrorMessage(serialized), {
    channel: "agent:resume",
    code: "CONFLICT",
    message: "HITL request is already resolved.",
    status: 409
  })
})

test("buildIpcErrorPayload preserves error code metadata", () => {
  const error = new Error("Reminders is unavailable.") as Error & { code: "UNAVAILABLE" }
  error.code = "UNAVAILABLE"

  assert.deepEqual(buildIpcErrorPayload("nativeExtensions:invoke", error), {
    channel: "nativeExtensions:invoke",
    code: "UNAVAILABLE",
    message: "Reminders is unavailable.",
    status: 503
  })
})

test("normalizeInvokeError rehydrates preload errors into client errors", () => {
  const error = normalizeInvokeError(
    new Error(
      serializeIpcErrorPayload({
        channel: "threads:clone",
        code: "NOT_FOUND",
        details: ["sourceThreadId: missing"],
        message: "Source thread was not found.",
        status: 404
      })
    )
  )

  assert.ok(error instanceof JingleIpcClientError)
  assert.equal(error.channel, "threads:clone")
  assert.equal(error.name, "NOT_FOUND")
  assert.equal(error.message, "Source thread was not found.")
  assert.equal(error.status, 404)
  assert.deepEqual(error.details, ["sourceThreadId: missing"])
})

test("extractIpcErrorPayload reads the name field when code metadata is already decoded", () => {
  const error = new Error("Invalid launcher action.")
  error.name = "INVALID_ARGUMENT"

  assert.deepEqual(extractIpcErrorPayload(error), {
    code: "INVALID_ARGUMENT",
    message: "Invalid launcher action.",
    status: getIpcErrorStatus("INVALID_ARGUMENT")
  })
})

test("normalizeInvokeError rehydrates decoded errors even when channel metadata is missing", () => {
  const error = new Error("Invalid launcher action.")
  error.name = "INVALID_ARGUMENT"

  const normalized = normalizeInvokeError(error)

  assert.ok(normalized instanceof JingleIpcClientError)
  assert.equal(normalized.channel, undefined)
  assert.equal(normalized.name, "INVALID_ARGUMENT")
  assert.equal(normalized.message, "Invalid launcher action.")
  assert.equal(normalized.status, getIpcErrorStatus("INVALID_ARGUMENT"))
})

test("normalizeInvokeError keeps non-IPC errors as plain errors", () => {
  const error = new Error("Socket closed unexpectedly.")

  const normalized = normalizeInvokeError(error)

  assert.equal(normalized, error)
  assert.ok(!(normalized instanceof JingleIpcClientError))
})
