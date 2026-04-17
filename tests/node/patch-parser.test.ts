import assert from "node:assert/strict"
import test from "node:test"
import { parsePatch } from "../../src/renderer/src/components/chat/artifact-preview/patch-parser"

test("parsePatch adapts unified diff output into renderer rows", () => {
  const parsed = parsePatch(
    [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 123..456 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,2 +1,3 @@",
      " const value = 1",
      "-console.log(value)",
      '+console.log("changed", value)',
      "+return value"
    ].join("\n")
  )

  assert.equal(parsed.files, 1)
  assert.equal(parsed.hunks, 1)
  assert.equal(parsed.additions, 2)
  assert.equal(parsed.deletions, 1)
  assert.deepEqual(parsed.rows.slice(0, 4), [
    {
      kind: "meta",
      newLineNumber: null,
      oldLineNumber: null,
      text: "diff --git a/src/app.ts b/src/app.ts"
    },
    {
      kind: "meta",
      newLineNumber: null,
      oldLineNumber: null,
      text: "--- a/src/app.ts"
    },
    {
      kind: "meta",
      newLineNumber: null,
      oldLineNumber: null,
      text: "+++ b/src/app.ts"
    },
    {
      kind: "hunk",
      newLineNumber: null,
      oldLineNumber: null,
      text: "@@ -1,2 +1,3 @@"
    }
  ])
  assert.deepEqual(parsed.rows.slice(4), [
    {
      kind: "context",
      newLineNumber: 1,
      oldLineNumber: 1,
      text: " const value = 1"
    },
    {
      kind: "remove",
      newLineNumber: null,
      oldLineNumber: 2,
      text: "-console.log(value)"
    },
    {
      kind: "add",
      newLineNumber: 2,
      oldLineNumber: null,
      text: '+console.log("changed", value)'
    },
    {
      kind: "add",
      newLineNumber: 3,
      oldLineNumber: null,
      text: "+return value"
    }
  ])
})

test("parsePatch does not create a synthetic blank row for trailing newlines", () => {
  const parsed = parsePatch(
    ["--- a/report.txt", "+++ b/report.txt", "@@ -2 +2 @@", "-before", "+after", ""].join("\n")
  )

  assert.equal(parsed.files, 1)
  assert.equal(parsed.hunks, 1)
  assert.equal(parsed.additions, 1)
  assert.equal(parsed.deletions, 1)
  assert.equal(parsed.rows.at(-1)?.text, "+after")
  assert.equal(parsed.rows.some((row) => row.kind === "context" && row.text === ""), false)
})

test("parsePatch preserves rename metadata without inventing numbered context rows", () => {
  const parsed = parsePatch(
    [
      "diff --git a/old-name.ts b/new-name.ts",
      "similarity index 100%",
      "rename from old-name.ts",
      "rename to new-name.ts"
    ].join("\n")
  )

  assert.equal(parsed.files, 1)
  assert.equal(parsed.hunks, 0)
  assert.equal(parsed.additions, 0)
  assert.equal(parsed.deletions, 0)
  assert.deepEqual(parsed.rows, [
    {
      kind: "meta",
      newLineNumber: null,
      oldLineNumber: null,
      text: "diff --git a/old-name.ts b/new-name.ts"
    },
    {
      kind: "meta",
      newLineNumber: null,
      oldLineNumber: null,
      text: "rename from old-name.ts"
    },
    {
      kind: "meta",
      newLineNumber: null,
      oldLineNumber: null,
      text: "rename to new-name.ts"
    },
    {
      kind: "meta",
      newLineNumber: null,
      oldLineNumber: null,
      text: "--- a/old-name.ts"
    },
    {
      kind: "meta",
      newLineNumber: null,
      oldLineNumber: null,
      text: "+++ b/new-name.ts"
    }
  ])
})
