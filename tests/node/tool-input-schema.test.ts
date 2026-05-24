import assert from "node:assert/strict"
import test from "node:test"
import {
  formatToolSchemaIssues,
  parseToolInputWithSchema,
  ToolSchemaValidationError,
  z
} from "../../src/main/agent/tool-input-schema"
import {
  nonEmptyTrimmedStringSchema,
  optionalNullableTrimmedStringSchema,
  optionalTrimmedStringSchema
} from "../../src/main/agent/tool-input-schema-primitives"

test("parseToolInputWithSchema returns parsed values", async () => {
  const schema = z.object({
    query: nonEmptyTrimmedStringSchema
  })

  const result = await parseToolInputWithSchema("web_search", schema, {
    query: "  latest openwork release  "
  })

  assert.deepEqual(result, {
    query: "latest openwork release"
  })
})

test("parseToolInputWithSchema surfaces zod issues with tool context", async () => {
  const schema = z.object({
    query: nonEmptyTrimmedStringSchema
  })

  await assert.rejects(
    parseToolInputWithSchema("web_search", schema, {
      query: "   "
    }),
    (error: unknown) => {
      assert.ok(error instanceof ToolSchemaValidationError)
      assert.equal(error.toolName, "web_search")
      assert.match(error.message, /web_search input validation failed/)
      assert.deepEqual(error.issues, ["query: Too small: expected string to have >=1 characters"])
      return true
    }
  )
})

test("formatToolSchemaIssues preserves nested field paths", () => {
  const schema = z.object({
    artifacts: z.array(
      z.object({
        title: nonEmptyTrimmedStringSchema
      })
    )
  })

  const parsed = schema.safeParse({
    artifacts: [{ title: "" }]
  })

  assert.equal(parsed.success, false)
  assert.deepEqual(formatToolSchemaIssues(parsed.error), [
    "artifacts.0.title: Too small: expected string to have >=1 characters"
  ])
})

test("string schema primitives trim and preserve optional/null semantics", () => {
  assert.equal(nonEmptyTrimmedStringSchema.parse("  summary  "), "summary")
  assert.equal(optionalTrimmedStringSchema.parse(undefined), undefined)
  assert.equal(optionalNullableTrimmedStringSchema.parse(null), null)
  assert.equal(optionalNullableTrimmedStringSchema.parse("  note  "), "note")
})
