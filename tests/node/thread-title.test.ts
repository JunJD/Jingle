import test from "node:test"
import assert from "node:assert/strict"
import { shouldAutoGenerateThreadTitle } from "../../src/shared/thread-title"

test("auto-generates when thread title is missing", () => {
  assert.equal(shouldAutoGenerateThreadTitle({ metadata: {}, title: undefined }), true)
})

test("auto-generates when thread title is the default date title", () => {
  assert.equal(shouldAutoGenerateThreadTitle({ metadata: {}, title: "对话 2026/3/8" }), true)
})

test("auto-generates for launcher threads even with the generic launcher title", () => {
  assert.equal(
    shouldAutoGenerateThreadTitle({
      metadata: { source: "launcher-ai" },
      title: "快速提问"
    }),
    true
  )
})

test("does not auto-generate for launcher threads after manual rename", () => {
  assert.equal(
    shouldAutoGenerateThreadTitle({
      metadata: { source: "launcher-ai" },
      title: "修复 SQLite 迁移"
    }),
    false
  )
})

test("does not overwrite a non-default user-facing title", () => {
  assert.equal(
    shouldAutoGenerateThreadTitle({
      metadata: { source: "history" },
      title: "修复 SQLite 迁移"
    }),
    false
  )
})
