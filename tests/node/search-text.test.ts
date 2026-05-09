import assert from "node:assert/strict"
import test from "node:test"
import { buildTrigramFtsQuery, buildUnicodeFtsQuery } from "../../src/main/search-text"

test("buildUnicodeFtsQuery quotes prefix terms for FTS5 syntax safety", () => {
  assert.equal(buildUnicodeFtsQuery("review budget"), '"review"* "budget"*')
})

test("buildUnicodeFtsQuery escapes segmented terms that contain punctuation", () => {
  const query = buildUnicodeFtsQuery("新增 v2.0.0 reminders")

  assert.ok(query)
  assert.doesNotMatch(query, /v2\.0\.0\*/)
  assert.match(query, /"v2\.0\.0"\*/)
})

test("buildTrigramFtsQuery escapes phrase quotes", () => {
  assert.equal(buildTrigramFtsQuery('新增 "reminder"'), '"新增 ""reminder"""')
})
