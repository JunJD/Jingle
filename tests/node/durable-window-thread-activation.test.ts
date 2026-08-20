import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  createDurableWindowThreadActivationCoordinator,
  type DurableWindowThreadActivationProjection
} from "../../src/renderer/src/ai-core/durable-window-thread-activation"

function deferred(): {
  promise: Promise<void>
  reject: (error: Error) => void
  resolve: () => void
} {
  let reject = (_error: Error): void => undefined
  let resolve = (): void => undefined
  const promise = new Promise<void>((onResolve, onReject) => {
    reject = onReject
    resolve = onResolve
  })
  return { promise, reject, resolve }
}

describe("durable window thread activation coordinator", () => {
  it("starts without projecting an unrevisioned bootstrap identity", () => {
    const coordinator = createDurableWindowThreadActivationCoordinator({
      bind: async (threadId) => ({ revision: 1, threadId }),
      cleanup: () => {},
      hydrate: async () => {},
      onBinding: () => {},
      onState: () => {}
    })

    assert.deepEqual(coordinator.getState(), {
      bindingRevision: null,
      error: null,
      phase: "initializing",
      threadId: null
    })
  })

  it("keeps the committed identity explicit when hydration fails", async () => {
    const states: DurableWindowThreadActivationProjection[] = []
    const cleaned: string[] = []
    const coordinator = createDurableWindowThreadActivationCoordinator({
      bind: async (threadId) => ({ revision: 2, threadId }),
      cleanup: (threadId) => cleaned.push(threadId),
      hydrate: async () => {
        throw new Error("hydrate failed")
      },
      onBinding: () => {},
      onState: (state) => states.push(state)
    })

    await assert.rejects(coordinator.requestActivation("thread-b"), /hydrate failed/)

    assert.deepEqual(coordinator.getState(), {
      bindingRevision: 2,
      error: "hydrate failed",
      phase: "failed",
      threadId: "thread-b"
    })
    assert.deepEqual(cleaned, ["thread-b"])
    assert.equal(
      states.some(({ phase, threadId }) => phase === "pending" && threadId === "thread-b"),
      true
    )
  })

  it("fences a slower hydration behind the latest binding revision", async () => {
    const work = new Map([
      ["thread-b", deferred()],
      ["thread-c", deferred()]
    ])
    const cleaned: string[] = []
    let revision = 1
    const coordinator = createDurableWindowThreadActivationCoordinator({
      bind: async (threadId) => ({ revision: ++revision, threadId }),
      cleanup: (threadId) => cleaned.push(threadId),
      hydrate: (threadId) => work.get(threadId)!.promise,
      onBinding: () => {},
      onState: () => {}
    })

    const older = coordinator.requestActivation("thread-b")
    const latest = coordinator.requestActivation("thread-c")
    work.get("thread-c")!.resolve()
    await latest
    work.get("thread-b")!.resolve()
    assert.deepEqual(await older, { revision: 3, threadId: "thread-c" })

    assert.deepEqual(coordinator.getState(), {
      bindingRevision: 3,
      error: null,
      phase: "ready",
      threadId: "thread-c"
    })
    assert.deepEqual(cleaned, ["thread-b"])
  })

  it("reuses one hydration across an ABA rebind to the same thread", async () => {
    const hydration = deferred()
    let hydrateCount = 0
    const cleaned: string[] = []
    const coordinator = createDurableWindowThreadActivationCoordinator({
      bind: async () => ({ revision: 1, threadId: null }),
      cleanup: (threadId) => cleaned.push(threadId),
      hydrate: () => {
        hydrateCount += 1
        return hydration.promise
      },
      onBinding: () => {},
      onState: () => {}
    })

    const first = coordinator.acceptBinding({ revision: 2, threadId: "thread-a" })
    const second = coordinator.acceptBinding({ revision: 4, threadId: "thread-a" })
    hydration.resolve()
    await Promise.all([first, second])

    assert.equal(hydrateCount, 1)
    assert.deepEqual(cleaned, [])
    assert.deepEqual(coordinator.getState(), {
      bindingRevision: 4,
      error: null,
      phase: "ready",
      threadId: "thread-a"
    })
  })
})
