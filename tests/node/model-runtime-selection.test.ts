import assert from "node:assert/strict"
import test from "node:test"
import {
  MODEL_RUNTIME_SELECTION_METADATA_KEY,
  MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY,
  parseModelRuntimeSelection,
  parseThreadModelRuntimeSelectionChangedEvent,
  readRunModelRuntimeSelection,
  readThreadModelRuntimeSelection,
  readThreadModelRuntimeSelectionRevision,
  withModelRuntimeSelection,
  withThreadModelRuntimeSelection
} from "../../src/shared/model-runtime-selection"
import { requirePersistedModelRuntimeSelection } from "../../src/main/model-provider/runtime-selection-admission"
import { JingleIpcError } from "../../src/main/ipc/error"

test("model runtime selection parser accepts only the exact typed snapshot", () => {
  const parsed = parseModelRuntimeSelection({
    modelId: "openai:gpt-5.6-sol",
    thinkingEffort: "max",
    version: 1
  })
  assert.deepEqual(parsed, {
    modelId: "openai:gpt-5.6-sol",
    thinkingEffort: "max",
    version: 1
  })
  assert.equal(Object.isFrozen(parsed), true)
  assert.deepEqual(
    parseModelRuntimeSelection({
      modelId: "openai:gpt-5",
      thinkingEffort: "minimal",
      version: 1
    }),
    { modelId: "openai:gpt-5", thinkingEffort: "minimal", version: 1 }
  )
  assert.equal(
    parseModelRuntimeSelection({
      modelId: "openai:gpt-5.6-sol",
      thinkingEffort: "max",
      trusted: true,
      version: 1
    }),
    null
  )
  assert.equal(
    parseModelRuntimeSelection({
      modelId: " openai:gpt-5.6-sol",
      thinkingEffort: "max",
      version: 1
    }),
    null
  )
  assert.equal(
    parseModelRuntimeSelection({
      modelId: "openai:gpt-5.6-sol",
      thinkingEffort: "extreme",
      version: 1
    }),
    null
  )
  assert.equal(
    parseModelRuntimeSelection({ modelId: "openai:gpt-5.6-sol", thinkingEffort: "max" }),
    null
  )
  assert.equal(
    parseModelRuntimeSelection({
      modelId: "openai:gpt-5.6-sol",
      thinkingEffort: "max",
      version: 2
    }),
    null
  )
})

test("model runtime selection parser snapshots data descriptors without invoking getters", () => {
  let getterCalls = 0
  const accessorSelection = {
    get modelId() {
      getterCalls += 1
      return "openai:gpt-5.6-sol"
    },
    thinkingEffort: "max",
    version: 1
  }
  assert.equal(parseModelRuntimeSelection(accessorSelection), null)
  assert.equal(getterCalls, 0)

  let propertyReads = 0
  const selection = new Proxy(
    {},
    {
      get() {
        propertyReads += 1
        return "forged-after-validation"
      },
      getOwnPropertyDescriptor(_target, property) {
        const values: Record<PropertyKey, unknown> = {
          modelId: "openai:gpt-5",
          thinkingEffort: "minimal",
          version: 1
        }
        return {
          configurable: true,
          enumerable: true,
          value: values[property],
          writable: true
        }
      },
      ownKeys() {
        return ["modelId", "thinkingEffort", "version"]
      }
    }
  )
  assert.deepEqual(parseModelRuntimeSelection(selection), {
    modelId: "openai:gpt-5",
    thinkingEffort: "minimal",
    version: 1
  })
  assert.equal(propertyReads, 0)
})

test("legacy thread and run metadata stays visible but never invents an effort", () => {
  assert.deepEqual(readThreadModelRuntimeSelection({ model: "openai:gpt-5.2" }), {
    kind: "legacy_missing_effort",
    modelId: "openai:gpt-5.2"
  })
  assert.deepEqual(readRunModelRuntimeSelection({ modelId: "openai:gpt-5.2" }), {
    kind: "legacy_missing_effort",
    modelId: "openai:gpt-5.2"
  })
  assert.deepEqual(readThreadModelRuntimeSelection({}), { kind: "missing" })
  assert.deepEqual(readRunModelRuntimeSelection({}), { kind: "missing" })
})

test("canonical metadata writer removes legacy model identity fields", () => {
  assert.deepEqual(
    withModelRuntimeSelection(
      { model: "stale-thread-model", modelId: "stale-run-model", title: "Keep" },
      { modelId: "openai:gpt-5.6-sol", thinkingEffort: "max", version: 1 }
    ),
    {
      [MODEL_RUNTIME_SELECTION_METADATA_KEY]: {
        modelId: "openai:gpt-5.6-sol",
        thinkingEffort: "max",
        version: 1
      },
      title: "Keep"
    }
  )
})

test("thread selection writer owns a monotonic durable revision and rejects corruption", () => {
  const selection = {
    modelId: "openai:gpt-5.6-sol",
    thinkingEffort: "max" as const,
    version: 1 as const
  }
  const first = withThreadModelRuntimeSelection({ title: "Keep" }, selection)
  assert.equal(first.revision, 1)
  assert.equal(readThreadModelRuntimeSelectionRevision(first.metadata), 1)
  assert.deepEqual(readThreadModelRuntimeSelection(first.metadata), {
    kind: "ready",
    selection
  })
  const second = withThreadModelRuntimeSelection(first.metadata, {
    ...selection,
    thinkingEffort: "high"
  })
  assert.equal(second.revision, 2)
  assert.equal(readThreadModelRuntimeSelectionRevision(second.metadata), 2)

  for (const metadata of [
    { [MODEL_RUNTIME_SELECTION_METADATA_KEY]: selection },
    { [MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY]: 1 }
  ]) {
    assert.deepEqual(readThreadModelRuntimeSelection(metadata), { kind: "invalid" })
    assert.throws(
      () => withThreadModelRuntimeSelection(metadata, selection),
      /selection and revision must be persisted together/
    )
  }

  for (const revision of [0, "2"]) {
    const metadata = {
      ...first.metadata,
      [MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY]: revision
    }
    assert.deepEqual(readThreadModelRuntimeSelection(metadata), { kind: "invalid" })
    assert.throws(
      () => withThreadModelRuntimeSelection(metadata, selection),
      /revision (?:is invalid|overflow)/
    )
  }
  assert.throws(
    () =>
      withThreadModelRuntimeSelection(
        {
          ...first.metadata,
          [MODEL_RUNTIME_SELECTION_REVISION_METADATA_KEY]: Number.MAX_SAFE_INTEGER
        },
        selection
      ),
    /revision overflow/
  )
})

test("thread selection event parser snapshots only the exact revisioned payload", () => {
  const event = parseThreadModelRuntimeSelectionChangedEvent({
    revision: 2,
    selection: {
      modelId: "openai:gpt-5.6-sol",
      thinkingEffort: "max",
      version: 1
    },
    threadId: "thread-1"
  })
  assert.ok(event)
  assert.deepEqual(event, {
    revision: 2,
    selection: {
      modelId: "openai:gpt-5.6-sol",
      thinkingEffort: "max",
      version: 1
    },
    threadId: "thread-1"
  })
  assert.equal(Object.isFrozen(event), true)
  assert.equal(parseThreadModelRuntimeSelectionChangedEvent({ ...event, extra: true }), null)
})

test("main admission maps typed persisted-selection reasons to FAILED_PRECONDITION", () => {
  for (const [metadata, owner] of [
    [{}, "thread"],
    [{ model: "openai:gpt-5" }, "thread"],
    [{ modelId: "openai:gpt-5" }, "run"],
    [{ modelRuntimeSelection: { version: 2 } }, "run"]
  ] as const) {
    assert.throws(
      () =>
        requirePersistedModelRuntimeSelection({
          channel: "agent:test",
          metadata,
          owner
        }),
      (error: unknown) => error instanceof JingleIpcError && error.code === "FAILED_PRECONDITION"
    )
  }
})
