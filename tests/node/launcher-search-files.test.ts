import test from "node:test"
import assert from "node:assert/strict"
import { resolveMacSpotlightNameQuery } from "../../src/main/services/launcher-search/providers/files"

test("resolveMacSpotlightNameQuery keeps compact single-line queries", () => {
  assert.equal(resolveMacSpotlightNameQuery("  project plan  "), "project plan")
  assert.equal(resolveMacSpotlightNameQuery("template.tsx"), "template.tsx")
})

test("resolveMacSpotlightNameQuery rejects multiline command output", () => {
  assert.equal(
    resolveMacSpotlightNameQuery("template:build -- --id 69d9801f31883cb134dcae97\nError: missing"),
    null
  )
})

test("resolveMacSpotlightNameQuery rejects oversized or noisy queries", () => {
  assert.equal(resolveMacSpotlightNameQuery("a ".repeat(9).trim()), null)
  assert.equal(resolveMacSpotlightNameQuery("x".repeat(121)), null)
})
