import assert from "node:assert/strict"
import test from "node:test"
import {
  formatIpcSchemaIssues,
  IpcSchemaValidationError,
  parseIpcPayloadWithSchema,
  z
} from "../../src/main/ipc/schema"
import {
  nonEmptyTrimmedStringSchema,
  optionalNormalizedTrimmedStringSchema
} from "../../src/main/ipc/schema-primitives"

test("parseIpcPayloadWithSchema returns parsed values", () => {
  const schema = z.object({
    threadId: nonEmptyTrimmedStringSchema
  })

  const result = parseIpcPayloadWithSchema("agent:cancel", schema, {
    threadId: "  thread-1  "
  })

  assert.deepEqual(result, {
    threadId: "thread-1"
  })
})

test("parseIpcPayloadWithSchema surfaces zod issues with channel context", () => {
  const schema = z.object({
    command: z.object({
      request_id: nonEmptyTrimmedStringSchema
    })
  })

  assert.throws(
    () =>
      parseIpcPayloadWithSchema("agent:resume", schema, {
        command: {
          request_id: "   "
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof IpcSchemaValidationError)
      assert.equal(error.channel, "agent:resume")
      assert.match(error.message, /agent:resume params validation failed/)
      assert.deepEqual(error.issues, [
        "command.request_id: Too small: expected string to have >=1 characters"
      ])
      return true
    }
  )
})

test("formatIpcSchemaIssues preserves nested field paths", () => {
  const schema = z.object({
    decision: z.object({
      request_id: nonEmptyTrimmedStringSchema
    })
  })

  const parsed = schema.safeParse({
    decision: {
      request_id: ""
    }
  })

  assert.equal(parsed.success, false)
  assert.deepEqual(formatIpcSchemaIssues(parsed.error), [
    "decision.request_id: Too small: expected string to have >=1 characters"
  ])
})

test("optionalNormalizedTrimmedStringSchema normalizes blanks to undefined", () => {
  assert.equal(optionalNormalizedTrimmedStringSchema.parse(undefined), undefined)
  assert.equal(optionalNormalizedTrimmedStringSchema.parse("  "), undefined)
  assert.equal(optionalNormalizedTrimmedStringSchema.parse("  gpt-5  "), "gpt-5")
})
