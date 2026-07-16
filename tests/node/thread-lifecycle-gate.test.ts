import assert from "node:assert/strict"
import test from "node:test"
import { AgentService } from "../../src/main/agent/service"
import { ThreadLifecycleGate } from "../../src/main/agent/thread-lifecycle-gate"

test("ThreadLifecycleGate aborts active runs and closes admission during shutdown", async () => {
  const gate = new ThreadLifecycleGate()
  const claim = await gate.claimRun("thread-active")
  assert.equal(claim.status, "accepted")
  if (claim.status !== "accepted") {
    return
  }

  let shutdownSettled = false
  const shutdown = gate.shutdown().then(() => {
    shutdownSettled = true
  })

  await Promise.resolve()
  assert.equal(claim.lease.signal.aborted, true)
  assert.equal((await gate.claimRun("thread-new")).status, "shutting_down")
  await assert.rejects(
    gate.withDeletion("thread-delete", async () => undefined),
    /application is shutting down/i
  )
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(shutdownSettled, false)

  claim.lease.complete()
  await shutdown
  assert.equal(shutdownSettled, true)
  assert.equal((await gate.claimRun("thread-after-shutdown")).status, "shutting_down")
})

test("AgentService rejects new commands after shutdown begins", async () => {
  const gate = new ThreadLifecycleGate()
  const service = new AgentService({} as never, gate, {} as never)
  const events: Array<{ code?: string; type: string }> = []

  await service.shutdown()
  const outcome = await service.dispatchInvoke(
    {
      message: { content: "too late", id: "message-after-shutdown" },
      modelId: "bdd",
      threadId: "thread-after-shutdown"
    },
    {
      send: (event) => events.push({ code: "code" in event ? event.code : undefined, type: event.type })
    }
  )

  assert.equal(outcome.type, "rejected")
  assert.equal(outcome.type === "rejected" ? outcome.error.code : null, "UNAVAILABLE")
  assert.deepEqual(events, [{ code: "UNAVAILABLE", type: "run_rejected" }])
})
