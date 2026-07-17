import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { ThreadLifecycleGate } from "../../src/main/agent/thread-lifecycle-gate"

const originalJingleHome = process.env.JINGLE_HOME
let jingleHome = ""

test.before(async () => {
  jingleHome = await mkdtemp(join(tmpdir(), "jingle-thread-lifecycle-gate-"))
  process.env.JINGLE_HOME = jingleHome
})

test.after(async () => {
  if (originalJingleHome === undefined) {
    delete process.env.JINGLE_HOME
  } else {
    process.env.JINGLE_HOME = originalJingleHome
  }
  await rm(jingleHome, { force: true, recursive: true })
})

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
  const { AgentService } = await import("../../src/main/agent/service")
  const gate = new ThreadLifecycleGate()
  const service = new AgentService({} as never, gate, {} as never)
  const events: Array<{ code?: string; type: string }> = []

  await service.shutdown()
  const outcome = await service.dispatchInvoke(
    {
      message: { content: "too late", id: "message-after-shutdown" },
      threadId: "thread-after-shutdown"
    },
    {
      send: (event) =>
        events.push({ code: "code" in event ? event.code : undefined, type: event.type })
    }
  )

  assert.equal(outcome.type, "rejected")
  assert.equal(outcome.type === "rejected" ? outcome.error.code : null, "UNAVAILABLE")
  assert.deepEqual(events, [{ code: "UNAVAILABLE", type: "run_rejected" }])
})

test("ThreadLifecycleGate rejects idle mutations while a run lease is active", async () => {
  const gate = new ThreadLifecycleGate()
  const claim = await gate.claimRun("thread-race")
  assert.equal(claim.status, "accepted")
  assert.equal(
    (
      await gate.withIdleMutation("thread-race", async () => {
        assert.fail("active run must prevent the mutation callback")
      })
    ).status,
    "running"
  )
  if (claim.status === "accepted") {
    claim.lease.complete()
  }
})

test("ThreadLifecycleGate holds run admission until an idle mutation commits", async () => {
  const gate = new ThreadLifecycleGate()
  let releaseMutation!: () => void
  const mutationBarrier = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  let mutationEntered!: () => void
  const entered = new Promise<void>((resolve) => {
    mutationEntered = resolve
  })
  const mutation = gate.withIdleMutation("thread-race", async () => {
    mutationEntered()
    await mutationBarrier
    return "persisted"
  })
  await entered

  let claimSettled = false
  const claimPromise = gate.claimRun("thread-race").then((claim) => {
    claimSettled = true
    return claim
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(claimSettled, false)

  releaseMutation()
  assert.deepEqual(await mutation, { status: "accepted", value: "persisted" })
  const claim = await claimPromise
  assert.equal(claim.status, "accepted")
  if (claim.status === "accepted") {
    claim.lease.complete()
  }
})
