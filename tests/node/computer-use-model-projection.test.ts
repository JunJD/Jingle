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
    window: { generation: "g1", nativeId: "w1", pid: 42, platform: "macos" }
  }
}

function button(index: number, ref: string, title: string): ComputerUseElement {
  return { actions: ["press"], index, ref, role: "button", title }
}

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
