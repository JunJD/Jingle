import assert from "node:assert/strict"
import test from "node:test"
import { reconcileRuntimeFormLocalValues } from "../../src/renderer/src/extension-runtime/form-local-values"
import type { ExtensionFormFieldNode } from "../../src/shared/extension-runtime-protocol"

function textField(id: string, value: string): ExtensionFormFieldNode {
  return {
    id,
    kind: "text-field",
    title: id,
    value
  }
}

test("runtime form local values keep pending input while snapshots are stale", () => {
  const result = reconcileRuntimeFormLocalValues({
    fields: [textField("title", "")],
    localValues: {
      title: "Buy milk"
    },
    pendingValues: new Map([["title", "Buy milk"]])
  })

  assert.deepEqual(result.localValues, {
    title: "Buy milk"
  })
  assert.deepEqual(Array.from(result.pendingValues.entries()), [["title", "Buy milk"]])
})

test("runtime form local values clear once the runtime snapshot catches up", () => {
  const result = reconcileRuntimeFormLocalValues({
    fields: [textField("title", "Buy milk")],
    localValues: {
      title: "Buy milk"
    },
    pendingValues: new Map([["title", "Buy milk"]])
  })

  assert.deepEqual(result.localValues, {})
  assert.equal(result.pendingValues.size, 0)
})

test("runtime form local values drop pending state for removed fields", () => {
  const result = reconcileRuntimeFormLocalValues({
    fields: [textField("body", "")],
    localValues: {
      title: "Buy milk"
    },
    pendingValues: new Map([["title", "Buy milk"]])
  })

  assert.deepEqual(result.localValues, {})
  assert.equal(result.pendingValues.size, 0)
})
