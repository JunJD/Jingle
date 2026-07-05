import assert from "node:assert/strict"
import test from "node:test"
import {
  acknowledgeRuntimeFormLocalValue,
  createRuntimeFormValueOverrides,
  reconcileRuntimeFormLocalValues
} from "../../src/renderer/src/extension-runtime/form-local-values"
import type { ExtensionFormFieldNode } from "../../src/shared/extension-runtime-protocol"

function textField(id: string, value: string): ExtensionFormFieldNode {
  return {
    id,
    kind: "text-field",
    title: id,
    value
  }
}

function datePicker(id: string, value: string): ExtensionFormFieldNode {
  return {
    id,
    kind: "date-picker",
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
    pendingValues: new Map([["title", { changeId: "change-1", value: "Buy milk" }]])
  })

  assert.deepEqual(result.localValues, {
    title: "Buy milk"
  })
  assert.deepEqual(Array.from(result.pendingValues.entries()), [
    ["title", { changeId: "change-1", value: "Buy milk" }]
  ])
})

test("runtime form local values wait for ack even when the snapshot value matches", () => {
  const result = reconcileRuntimeFormLocalValues({
    fields: [textField("title", "Buy milk")],
    localValues: {
      title: "Buy milk"
    },
    pendingValues: new Map([["title", { changeId: "change-1", value: "Buy milk" }]])
  })

  assert.deepEqual(result.localValues, {
    title: "Buy milk"
  })
  assert.equal(result.pendingValues.size, 1)

  const acknowledged = acknowledgeRuntimeFormLocalValue({
    changeId: "change-1",
    fieldId: "title",
    localValues: result.localValues,
    pendingValues: result.pendingValues
  })

  assert.deepEqual(acknowledged.localValues, {})
  assert.equal(acknowledged.pendingValues.size, 0)
})

test("runtime form local values reveal normalized runtime value after ack", () => {
  const result = reconcileRuntimeFormLocalValues({
    fields: [textField("title", "Buy milk")],
    localValues: {
      title: "  Buy milk  "
    },
    pendingValues: new Map([["title", { changeId: "change-1", value: "  Buy milk  " }]])
  })

  assert.deepEqual(result.localValues, {
    title: "  Buy milk  "
  })

  const acknowledged = acknowledgeRuntimeFormLocalValue({
    changeId: "change-1",
    fieldId: "title",
    localValues: result.localValues,
    pendingValues: result.pendingValues
  })

  assert.deepEqual(acknowledged.localValues, {})
  assert.equal(acknowledged.pendingValues.size, 0)
})

test("runtime form local values ignore stale acks", () => {
  const result = acknowledgeRuntimeFormLocalValue({
    changeId: "change-1",
    fieldId: "title",
    localValues: {
      title: "Buy milk"
    },
    pendingValues: new Map([["title", { changeId: "change-2", value: "Buy milk" }]])
  })

  assert.deepEqual(result.localValues, {
    title: "Buy milk"
  })
  assert.deepEqual(Array.from(result.pendingValues.entries()), [
    ["title", { changeId: "change-2", value: "Buy milk" }]
  ])
})

test("runtime form local values drop pending state for removed fields", () => {
  const result = reconcileRuntimeFormLocalValues({
    fields: [textField("body", "")],
    localValues: {
      title: "Buy milk"
    },
    pendingValues: new Map([["title", { changeId: "change-1", value: "Buy milk" }]])
  })

  assert.deepEqual(result.localValues, {})
  assert.equal(result.pendingValues.size, 0)
})

test("runtime form submit values only include local overrides", () => {
  const result = createRuntimeFormValueOverrides({
    fields: [textField("title", "Snapshot title"), datePicker("due", "2026-06-01")],
    localValues: {
      title: "Pending title"
    }
  })

  assert.deepEqual(result, {
    title: "Pending title"
  })
})

test("runtime form submit values omit empty override payload", () => {
  const result = createRuntimeFormValueOverrides({
    fields: [datePicker("due", "2026-06-01")],
    localValues: {}
  })

  assert.equal(result, undefined)
})
