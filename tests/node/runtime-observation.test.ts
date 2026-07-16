import assert from "node:assert/strict"
import { setImmediate as waitForImmediate } from "node:timers/promises"
import test from "node:test"
import { createRuntimeObservationExecution } from "../../packages/langchain-agent-harness/src/runtime-observation-capability"
import type { RuntimeProjectionFailureRecordInput } from "../../packages/langchain-agent-harness/src/runtime-observation"

const runContext = {
  runId: "projection-observation-run",
  threadId: "projection-observation-thread",
  workspacePath: "/tmp/projection-observation-thread"
}

test("projection observation dispatches typed failure facts without awaiting the sink", () => {
  const failure = new Error("title projection failed")
  const records: RuntimeProjectionFailureRecordInput[] = []
  const neverSettles = new Promise<void>((resolve) => {
    void resolve
  })
  const observation = createRuntimeObservationExecution({
    observation: {
      sink: {
        projection: {
          recordFailure: (record) => {
            records.push(record)
            return neverSettles
          }
        }
      }
    },
    runContext
  })

  const result = observation.observeProjectionFailure({
    error: failure,
    projection: "title"
  })

  assert.equal(result, undefined)
  assert.deepEqual(records, [
    {
      ...runContext,
      error: failure,
      projection: "title"
    }
  ])
})

test("projection observation isolates synchronous and asynchronous sink failures", async () => {
  const warnings: unknown[][] = []
  const previousWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args)
  }

  try {
    const synchronous = createRuntimeObservationExecution({
      observation: {
        sink: {
          projection: {
            recordFailure: () => {
              throw new Error("synchronous sink failure")
            }
          }
        }
      },
      runContext
    })
    const asynchronous = createRuntimeObservationExecution({
      observation: {
        sink: {
          projection: {
            recordFailure: async () => {
              throw new Error("asynchronous sink failure")
            }
          }
        }
      },
      runContext
    })

    assert.doesNotThrow(() =>
      synchronous.observeProjectionFailure({
        error: new Error("memory projection failed"),
        projection: "memory-recording"
      })
    )
    assert.doesNotThrow(() =>
      asynchronous.observeProjectionFailure({
        error: new Error("title projection failed"),
        projection: "title"
      })
    )
    await waitForImmediate()

    assert.equal(warnings.length, 2)
    assert.match(String(warnings[0]?.[0]), /Projection failure sink failed/)
    assert.match(String(warnings[1]?.[0]), /Projection failure sink failed/)
  } finally {
    console.warn = previousWarn
  }
})
