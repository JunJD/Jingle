import assert from "node:assert/strict"
import test from "node:test"
import {
  ComputerUseObservationStore,
  type ComputerUseElement,
  type ComputerUseObservation
} from "../../packages/computer-use-core/src"

function observationInput(input: {
  capturedAt: number
  elements: readonly ComputerUseElement[]
  epoch: number
}): Omit<ComputerUseObservation, "stateId"> {
  return {
    application: { id: "com.example.fixture", name: "Fixture" },
    capturedAt: input.capturedAt,
    elements: input.elements,
    epoch: input.epoch,
    resourceKey: "desktop-pid:42",
    sourceTruncated: false,
    window: { generation: "g1", nativeId: "w1", pid: 42, platform: "macos" }
  }
}

function button(index: number, ref: string, title: string): ComputerUseElement {
  return { actions: ["press"], index, ref, role: "button", title }
}

test("equal ref strings cannot produce a diff without an explicit identity matcher", () => {
  const stateIds = ["state-base", "state-successor"]
  const store = new ComputerUseObservationStore(
    8,
    {},
    { idFactory: { createStateId: () => stateIds.shift() ?? "state-exhausted" } }
  )
  const base = store.create(
    observationInput({ capturedAt: 1, elements: [button(0, "same-ref", "Before")], epoch: 0 })
  )
  const successor = store.create(
    observationInput({ capturedAt: 2, elements: [button(0, "same-ref", "After")], epoch: 1 })
  )

  const projection = store.project({
    baseStateId: base.stateId,
    stateId: successor.stateId
  })

  assert.equal(projection.kind, "full")
  assert.equal(projection.kind === "full" ? projection.reason : null, "low_identity_confidence")
  assert.equal(projection.kind === "full" ? projection.stateId : null, successor.stateId)
  assert.equal(store.get(successor.stateId), successor)
})

test("observation retention applies a canonical byte budget to dense states", () => {
  const largeText = "x".repeat(1_024)
  const elements = Array.from({ length: 750 }, (_, index) => ({
    actions: ["press" as const],
    description: largeText,
    identifier: largeText,
    index,
    ref: `ref-${index}`,
    role: "button",
    title: largeText,
    value: largeText
  }))
  const input = observationInput({ capturedAt: 1, elements, epoch: 0 })
  const stateIds = ["state-0", "state-1", "state-2"]
  const store = new ComputerUseObservationStore(
    128,
    {
      retainedObservationByteLimit: 7 * 1024 * 1024,
      singleObservationByteLimit: 4 * 1024 * 1024
    },
    { idFactory: { createStateId: () => stateIds.shift() ?? "state-exhausted" } }
  )

  const first = store.create(input)
  const second = store.create({ ...input, capturedAt: 2, epoch: 1 })
  const third = store.create({ ...input, capturedAt: 3, epoch: 2 })

  assert.equal(store.get(first.stateId), undefined)
  assert.equal(store.get(second.stateId), second)
  assert.equal(store.get(third.stateId), third)
  const reanchor = store.project({ baseStateId: first.stateId, stateId: third.stateId })
  assert.equal(reanchor.kind === "full" ? reanchor.reason : null, "state_evicted")
  assert.equal(
    store.expand({ limit: 1, offset: 749, stateId: third.stateId }).elements[0]?.ref,
    "ref-749"
  )
  assert.equal(
    store.search({ limit: 1, query: "ref-749", stateId: third.stateId }).elements[0]?.ref,
    "ref-749"
  )
  assert.equal(store.inspect({ refs: ["ref-749"], stateId: third.stateId }).stateId, third.stateId)

  const tooSmallStore = new ComputerUseObservationStore(
    1,
    {
      retainedObservationByteLimit: 4 * 1024 * 1024,
      singleObservationByteLimit: 2 * 1024 * 1024
    },
    { idFactory: { createStateId: () => "oversized" } }
  )
  assert.throws(() => tooSmallStore.create(input), /exceeds the .* single-state retention limit/)

  assert.throws(
    () =>
      new ComputerUseObservationStore().create(
        observationInput({
          capturedAt: 1,
          elements: [...elements, button(750, "ref-over-limit", "Over limit")],
          epoch: 0
        })
      ),
    /must not exceed 750 elements/
  )
})

test("unconfirmed overlapping refs force a full re-anchor instead of an updated element", () => {
  const stateIds = ["state-base", "state-successor"]
  let diffProjectorCalls = 0
  const store = new ComputerUseObservationStore(
    8,
    {},
    {
      diffProjector: {
        project: ({ successor }) => {
          diffProjectorCalls += 1
          return { added: [], removed: [], updated: [successor.elements[1]!] }
        }
      },
      idFactory: { createStateId: () => stateIds.shift() ?? "state-exhausted" },
      refMatcher: {
        match: () => ({
          confidence: 1,
          reason: "semantic_match",
          stableRefs: ["confirmed"]
        })
      }
    }
  )
  const base = store.create(
    observationInput({
      capturedAt: 1,
      elements: [button(0, "confirmed", "Save"), button(1, "ambiguous", "Before")],
      epoch: 0
    })
  )
  const successor = store.create(
    observationInput({
      capturedAt: 2,
      elements: [button(0, "confirmed", "Save"), button(1, "ambiguous", "After")],
      epoch: 1
    })
  )

  const projection = store.project({
    baseStateId: base.stateId,
    stateId: successor.stateId
  })

  assert.equal(projection.kind, "full")
  assert.equal(projection.kind === "full" ? projection.reason : null, "low_identity_confidence")
  assert.equal("updated" in projection, false)
  assert.equal(diffProjectorCalls, 0)
  assert.equal(store.get(successor.stateId), successor)
  assert.deepEqual(store.inspect({ refs: ["ambiguous"], stateId: successor.stateId }).elements, [
    successor.elements[1]
  ])
  assert.deepEqual(store.search({ query: "after", stateId: successor.stateId }).elements, [
    successor.elements[1]
  ])
})
